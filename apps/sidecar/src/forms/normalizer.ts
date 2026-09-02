import { createHash } from "node:crypto";

import type {
  ChoiceOption,
  FormId,
  FormLogic,
  FormSnapshot,
  GroupId,
  LogicDestination,
  LogicTransition,
  NormalizedResponse,
  OptionKey,
  OrdinalQuestion,
  Question,
  QuestionGroup,
  QuestionId,
  Section,
  SectionId,
  SectionNode,
  UnsupportedQuestion,
} from "@survey-synth/domain";
import { resolveResponsePath } from "@survey-synth/domain";

import { sidecarError } from "../errors.js";
import type {
  RawGoogleForm,
  RawGoogleItem,
  RawGoogleQuestion,
  RawGoogleQuestionGroupItem,
} from "./google-types.js";

const ENTRY_SECTION_RAW_ID = "__entry__";

type RecordValue = Record<string, unknown>;

interface SectionDraft {
  readonly rawId: string;
  readonly section: Section;
  readonly questionIds: QuestionId[];
}

interface RoutingCandidate {
  readonly sourceQuestionId: QuestionId;
  readonly optionKey: OptionKey;
  readonly goToAction?: string;
  readonly goToSectionId?: string;
}

interface GridContext {
  readonly groupId: GroupId;
  readonly presentation: "radio" | "checkbox";
  readonly options: readonly ChoiceOption[];
}

interface NormalizationState {
  readonly questions: Question[];
  readonly groups: QuestionGroup[];
  readonly routing: RoutingCandidate[];
  readonly questionIds: Set<QuestionId>;
}

export const formIdForRaw = (value: string): FormId => value as FormId;
export const sectionIdForRaw = (value: string): SectionId => value as SectionId;
export const questionIdForRaw = (value: string): QuestionId => value as QuestionId;
export const groupIdForRaw = (value: string): GroupId => value as GroupId;

export class GoogleFormNormalizer {
  public normalize(raw: unknown, capturedAt = new Date().toISOString()): FormSnapshot {
    const form = parseRawForm(raw);
    if (capturedAt.length === 0) throw invalidImport("Form capture time is missing");

    const sectionDrafts = createSectionDrafts(form.items);
    const sectionByRawId = new Map<string, SectionId>(
      sectionDrafts.map((draft) => [draft.rawId, draft.section.id]),
    );
    const currentSectionByItem = sectionForEachItem(form.items, sectionDrafts);
    const state: NormalizationState = {
      questions: [],
      groups: [],
      routing: [],
      questionIds: new Set(),
    };

    for (let index = 0; index < form.items.length; index += 1) {
      const item = form.items[index];
      if (item === undefined) continue;
      const sectionId = currentSectionByItem[index];
      if (sectionId === undefined) throw invalidImport("Form section could not be resolved");
      const itemRecord = asRecord(item);
      if (itemRecord.questionItem !== undefined) {
        const questionItem = requireRecord(itemRecord.questionItem);
        const question = normalizeQuestion(
          questionItem.question,
          itemRecord,
          sectionId,
          undefined,
          state,
        );
        addQuestion(state, question, sectionDrafts, sectionId);
      }
      if (itemRecord.questionGroupItem !== undefined) {
        const group = normalizeGroup(
          itemRecord.questionGroupItem,
          itemRecord,
          sectionId,
          state,
          sectionDrafts,
        );
        state.groups.push(group);
      }
    }

    const sections = sectionDrafts.map(({ section, questionIds }) => ({
      ...section,
      questionIds: [...questionIds],
    }));
    const sectionNodes = createSectionNodes(sections);
    const transitions = createTransitions(state.routing, sectionByRawId);
    const affectedQuestions = new Set(transitions.map((transition) => transition.sourceQuestionId));
    const questions = state.questions.map((question) =>
      affectedQuestions.has(question.id) ? { ...question, affectsNavigation: true } : question,
    );
    const logic: FormLogic = {
      entrySectionId: sectionIdForRaw(ENTRY_SECTION_RAW_ID),
      sections: sectionNodes,
      transitions,
      coverage: state.routing.length === 0 ? "none" : "partial",
      hasRestartFlow: transitions.some((transition) => transition.destination.type === "restart"),
    };
    const snapshotWithoutHash = {
      formId: formIdForRaw(form.formId),
      title: form.info.title,
      ...(optionalString(form.info.description) === undefined
        ? {}
        : { description: optionalString(form.info.description) }),
      capturedAt,
      schemaHash: "",
      sections,
      questions,
      groups: state.groups,
      logic,
    } satisfies Omit<FormSnapshot, "schemaHash"> & { schemaHash: string };
    return {
      ...snapshotWithoutHash,
      schemaHash: schemaHash(snapshotWithoutHash),
    };
  }
}

export class GoogleResponseNormalizer {
  public normalizeAll(form: FormSnapshot, rawResponses: readonly unknown[]): NormalizedResponse[] {
    const questionsByRawId = new Map<string, Question>();
    for (const question of form.questions) {
      questionsByRawId.set(question.id, question);
    }

    return rawResponses.map((raw) => {
      const response = parseRawResponse(raw);
      const answers: Record<QuestionId, { state: "answered"; value: QuestionAnswerValue }> = {};
      for (const [rawQuestionId, rawAnswer] of Object.entries(response.answers ?? {})) {
        const question = questionsByRawId.get(rawQuestionId);
        if (question === undefined) continue;
        const value = normalizeAnswer(question, rawAnswer);
        if (value !== undefined) answers[question.id] = { state: "answered", value };
      }
      const path = resolveResponsePath(form, answers);
      const completeAnswers = completeAnswerSlots(form, answers, path);
      return {
        responseId: response.responseId as NormalizedResponse["responseId"],
        ...(response.createTime === undefined ? {} : { createdAt: response.createTime }),
        ...(response.lastSubmittedTime === undefined
          ? {}
          : { lastSubmittedAt: response.lastSubmittedTime }),
        answers: completeAnswers,
        origin: "original" as const,
        path,
      };
    });
  }
}

type QuestionAnswerValue = Extract<
  NonNullable<NormalizedResponse["answers"][QuestionId]>,
  { state: "answered" }
>["value"];

const parseRawForm = (value: unknown): RawGoogleForm => {
  const form = requireRecord(value);
  const formId = requiredString(form.formId, "Form ID");
  const info = requireRecord(form.info);
  const title = requiredString(info.title, "Form title");
  if (!Array.isArray(form.items)) throw invalidImport("Google Form items are invalid");
  return {
    formId,
    info: {
      title,
      ...(optionalString(info.description) === undefined
        ? {}
        : { description: optionalString(info.description) }),
      ...(optionalString(info.documentTitle) === undefined
        ? {}
        : { documentTitle: optionalString(info.documentTitle) }),
    },
    items: form.items as RawGoogleItem[],
  };
};

const parseRawResponse = (
  value: unknown,
): {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  answers?: Readonly<Record<string, RawAnswerRecord>>;
} => {
  const response = requireRecord(value);
  const responseId = requiredString(response.responseId, "Response ID");
  const answers = response.answers;
  if (hasOwn(response, "answers") && !isRecord(answers)) {
    throw invalidImport("Google response answers are invalid");
  }
  const parsedAnswers: Record<string, RawAnswerRecord> = {};
  for (const [questionId, answer] of Object.entries(answers ?? {})) {
    parsedAnswers[questionId] = validAnswerRecord(answer, questionId);
  }
  return {
    responseId,
    ...(strictOptionalString(response, "createTime") === undefined
      ? {}
      : { createTime: strictOptionalString(response, "createTime") }),
    ...(strictOptionalString(response, "lastSubmittedTime") === undefined
      ? {}
      : { lastSubmittedTime: strictOptionalString(response, "lastSubmittedTime") }),
    ...(hasOwn(response, "answers") ? { answers: parsedAnswers } : {}),
  };
};

type RawAnswerRecord = RecordValue;

const matchingOptions = (options: readonly ChoiceOption[], value: string): ChoiceOption[] => {
  const normalizedValue = normalizeChoiceValue(value);
  return options.filter((option) => normalizeChoiceValue(option.label) === normalizedValue);
};

const normalizeChoiceValue = (value: string): string => value.normalize("NFKC").trim();

const createSectionDrafts = (items: readonly RawGoogleItem[]): SectionDraft[] => {
  const drafts: SectionDraft[] = [
    {
      rawId: ENTRY_SECTION_RAW_ID,
      section: {
        id: sectionIdForRaw(ENTRY_SECTION_RAW_ID),
        title: "",
        order: 0,
        questionIds: [],
      },
      questionIds: [],
    },
  ];
  const seen = new Set<string>([ENTRY_SECTION_RAW_ID]);
  for (const item of items) {
    const record = asRecord(item);
    if (record.pageBreakItem === undefined) continue;
    const rawId = requiredString(record.itemId, "Section ID");
    if (seen.has(rawId)) throw invalidImport("Google Form contains duplicate section IDs");
    seen.add(rawId);
    const title = optionalString(record.title) ?? "";
    const description = optionalString(record.description);
    drafts.push({
      rawId,
      section: {
        id: sectionIdForRaw(rawId),
        title,
        ...(description === undefined ? {} : { description }),
        order: drafts.length,
        questionIds: [],
      },
      questionIds: [],
    });
  }
  return drafts;
};

const sectionForEachItem = (
  items: readonly RawGoogleItem[],
  drafts: readonly SectionDraft[],
): SectionId[] => {
  const sectionIds = drafts.map((draft) => draft.section.id);
  const result: SectionId[] = [];
  let sectionIndex = 0;
  for (const item of items) {
    if (asRecord(item).pageBreakItem !== undefined) sectionIndex += 1;
    const sectionId = sectionIds[sectionIndex];
    if (sectionId === undefined) throw invalidImport("Form section could not be resolved");
    result.push(sectionId);
  }
  return result;
};

const normalizeGroup = (
  value: unknown,
  item: RecordValue,
  sectionId: SectionId,
  state: NormalizationState,
  sectionDrafts: readonly SectionDraft[],
): QuestionGroup => {
  const groupItem = requireRecord(value) as RawGoogleQuestionGroupItem & RecordValue;
  const rawGroupId = requiredString(item.itemId, "Question group ID");
  const grid = requireRecord(groupItem.grid);
  const columns = requireRecord(grid.columns);
  const type = requiredString(columns.type, "Grid choice type");
  const presentation = gridPresentation(type);
  const options = normalizeOptions(columns.options, `group:${rawGroupId}`, undefined, false);
  if (!Array.isArray(groupItem.questions)) throw invalidImport("Grid rows are invalid");
  const questionIds: QuestionId[] = [];
  for (const rawQuestion of groupItem.questions) {
    const question = normalizeQuestion(
      rawQuestion,
      item,
      sectionId,
      {
        groupId: groupIdForRaw(rawGroupId),
        presentation,
        options,
      },
      state,
    );
    addQuestion(state, question, sectionDrafts, sectionId);
    questionIds.push(question.id);
  }
  const title = optionalString(item.title) ?? "";
  const description = optionalString(item.description);
  return {
    id: groupIdForRaw(rawGroupId),
    title,
    ...(description === undefined ? {} : { description }),
    kind: "grid",
    presentation,
    options,
    questionIds,
    shuffleQuestions: grid.shuffleQuestions === true,
  };
};

const normalizeQuestion = (
  value: unknown,
  item: RecordValue,
  sectionId: SectionId,
  grid: GridContext | undefined,
  state: NormalizationState,
): Question => {
  const question = requireRecord(value) as RawGoogleQuestion & RecordValue;
  const rawQuestionId = requiredString(question.questionId, "Question ID");
  const id = questionIdForRaw(rawQuestionId);
  const required = optionalBoolean(question.required) ?? false;
  const title = grid === undefined ? (optionalString(item.title) ?? "") : rowTitle(question);
  const description = grid === undefined ? optionalString(item.description) : undefined;
  const base = {
    id,
    title,
    ...(description === undefined ? {} : { description }),
    sectionId,
    required,
    affectsNavigation: false,
    ...(grid === undefined ? {} : { groupId: grid.groupId }),
  };

  const fields = [
    "choiceQuestion",
    "textQuestion",
    "scaleQuestion",
    "dateQuestion",
    "timeQuestion",
    "fileUploadQuestion",
    "rowQuestion",
    "ratingQuestion",
  ].filter((field) => question[field] !== undefined);
  const unknownField = Object.keys(question).find(
    (field) => !["questionId", "required", "grading", ...questionKinds].includes(field),
  );
  if (grid !== undefined) {
    if (question.rowQuestion === undefined) throw invalidImport("Grid row question is invalid");
    return grid.presentation === "radio"
      ? {
          ...base,
          kind: "single_choice",
          presentation: "radio",
          options: grid.options,
          shuffle: false,
        }
      : {
          ...base,
          kind: "multi_choice",
          presentation: "checkbox",
          options: grid.options,
          shuffle: false,
        };
  }
  if (fields.length !== 1) {
    return unsupportedQuestion(base, fields[0] ?? unknownField ?? "unknown");
  }

  const field = fields[0];
  switch (field) {
    case "choiceQuestion": {
      const choice = requireRecord(question.choiceQuestion);
      const type = requiredString(choice.type, "Choice type");
      const isMulti = type === "CHECKBOX";
      if (type !== "RADIO" && type !== "DROP_DOWN" && !isMulti) {
        return unsupportedQuestion(base, `choiceQuestion:${type}`);
      }
      const options = normalizeOptions(
        choice.options,
        `question:${rawQuestionId}`,
        { sourceQuestionId: id, state },
        !isMulti,
      );
      return isMulti
        ? {
            ...base,
            kind: "multi_choice",
            presentation: "checkbox",
            options,
            shuffle: choice.shuffle === true,
          }
        : {
            ...base,
            kind: "single_choice",
            presentation: type === "DROP_DOWN" ? "dropdown" : "radio",
            options,
            shuffle: choice.shuffle === true,
          };
    }
    case "textQuestion": {
      const text = requireRecord(question.textQuestion);
      return {
        ...base,
        kind: "text",
        presentation: text.paragraph === true ? "paragraph" : "short",
      };
    }
    case "scaleQuestion": {
      const scale = requireRecord(question.scaleQuestion);
      const low = requiredFiniteNumber(scale.low, "Scale lower bound");
      const high = requiredFiniteNumber(scale.high, "Scale upper bound");
      if (high < low) throw invalidImport("Google scale bounds are invalid");
      return {
        ...base,
        kind: "ordinal",
        presentation: "linear_scale",
        min: low,
        max: high,
        ...(optionalString(scale.lowLabel) === undefined
          ? {}
          : { lowLabel: optionalString(scale.lowLabel) }),
        ...(optionalString(scale.highLabel) === undefined
          ? {}
          : { highLabel: optionalString(scale.highLabel) }),
      };
    }
    case "dateQuestion": {
      const date = requireRecord(question.dateQuestion);
      return {
        ...base,
        kind: "date",
        includeTime: date.includeTime === true,
        includeYear: date.includeYear === true,
      };
    }
    case "timeQuestion": {
      const time = requireRecord(question.timeQuestion);
      return { ...base, kind: "time", duration: time.duration === true };
    }
    case "fileUploadQuestion": {
      const file = requireRecord(question.fileUploadQuestion);
      const types = optionalStringArray(file.types);
      const maxFiles = optionalFiniteNumber(file.maxFiles) ?? 1;
      if (maxFiles < 0) throw invalidImport("File upload limit is invalid");
      const maxFileSizeBytes = optionalString(file.maxFileSize);
      return {
        ...base,
        kind: "file",
        allowedTypes: types,
        maxFiles,
        ...(maxFileSizeBytes === undefined ? {} : { maxFileSizeBytes }),
      };
    }
    case "ratingQuestion": {
      const rating = requireRecord(question.ratingQuestion);
      const max = requiredFiniteNumber(rating.ratingScaleLevel, "Rating scale level");
      const presentation = ratingPresentation(optionalString(rating.iconType));
      if (presentation === undefined || max <= 0) {
        return unsupportedQuestion(base, "ratingQuestion");
      }
      return { ...base, kind: "ordinal", presentation, min: 1, max };
    }
    case "rowQuestion":
      return unsupportedQuestion(base, "rowQuestion");
    default:
      return unsupportedQuestion(base, field ?? "unknown");
  }
};

const questionKinds = [
  "choiceQuestion",
  "textQuestion",
  "scaleQuestion",
  "dateQuestion",
  "timeQuestion",
  "fileUploadQuestion",
  "rowQuestion",
  "ratingQuestion",
] as const;

const normalizeOptions = (
  value: unknown,
  scope: string,
  routing: { sourceQuestionId: QuestionId; state: NormalizationState } | undefined,
  allowNavigation: boolean,
): ChoiceOption[] => {
  if (!Array.isArray(value)) throw invalidImport("Google choice options are invalid");
  return value.map((rawOption, index) => {
    const option = requireRecord(rawOption);
    if (typeof option.value !== "string") throw invalidImport("Google choice value is invalid");
    const key = `option:${scope}:${index}` as OptionKey;
    const isOther = optionalBoolean(option.isOther) ?? false;
    if (routing !== undefined && allowNavigation && hasRoute(option)) {
      routing.state.routing.push({
        sourceQuestionId: routing.sourceQuestionId,
        optionKey: key,
        ...(optionalString(option.goToAction) === undefined
          ? {}
          : { goToAction: optionalString(option.goToAction) }),
        ...(optionalString(option.goToSectionId) === undefined
          ? {}
          : { goToSectionId: optionalString(option.goToSectionId) }),
      });
    }
    return { key, label: option.value, ...(isOther ? { isOther: true } : {}) };
  });
};

const createSectionNodes = (sections: readonly Section[]): SectionNode[] =>
  sections.map((section, index) => {
    const nextSection = sections[index + 1];
    return {
      id: section.id,
      order: section.order,
      questionIds: section.questionIds,
      ...(nextSection === undefined ? {} : { nextSectionId: nextSection.id }),
    };
  });

const createTransitions = (
  candidates: readonly RoutingCandidate[],
  sectionByRawId: ReadonlyMap<string, SectionId>,
): LogicTransition[] =>
  candidates.flatMap((candidate) => {
    const destination = destinationForCandidate(candidate, sectionByRawId);
    return destination === undefined
      ? []
      : [
          {
            sourceQuestionId: candidate.sourceQuestionId,
            optionKey: candidate.optionKey,
            destination,
            evidence: "api_confirmed" as const,
          },
        ];
  });

const destinationForCandidate = (
  candidate: RoutingCandidate,
  sectionByRawId: ReadonlyMap<string, SectionId>,
): LogicDestination | undefined => {
  if (candidate.goToSectionId !== undefined) {
    const sectionId = sectionByRawId.get(candidate.goToSectionId);
    if (sectionId === undefined)
      throw invalidImport("Google branch destination section is invalid");
    return { type: "section", sectionId };
  }
  switch (candidate.goToAction) {
    case "NEXT_SECTION":
      return { type: "next_section" };
    case "SUBMIT_FORM":
      return { type: "submit" };
    case "RESTART_FORM":
      return { type: "restart" };
    default:
      return undefined;
  }
};

const normalizeAnswer = (
  question: Question,
  raw: RawAnswerRecord,
): QuestionAnswerValue | undefined => {
  const textValues = textAnswerValues(raw);
  const fileValues = fileAnswerValues(raw);
  if (textValues.length === 0 && fileValues.length === 0) return undefined;
  switch (question.kind) {
    case "single_choice": {
      const value = textValues[0];
      if (value === undefined) throw invalidImport("Google choice answer is invalid");
      const matches = matchingOptions(question.options, value);
      if (matches.length === 0) throw invalidImport("Google choice answer is not in Form options");
      if (matches.length > 1) throw invalidImport("Google choice answer is ambiguous");
      const selected = matches[0];
      if (selected === undefined) throw invalidImport("Google choice answer is invalid");
      return { kind: "single_choice", optionKey: selected.key, label: value };
    }
    case "multi_choice": {
      const optionKeys = textValues.map((value) => {
        const matches = matchingOptions(question.options, value);
        if (matches.length === 0)
          throw invalidImport("Google checkbox answer is not in Form options");
        if (matches.length > 1) throw invalidImport("Google checkbox answer is ambiguous");
        const selected = matches[0];
        if (selected === undefined) throw invalidImport("Google checkbox answer is invalid");
        return selected.key;
      });
      return { kind: "multi_choice", optionKeys, labels: textValues };
    }
    case "ordinal": {
      const value = textValues[0];
      const number = value === undefined ? undefined : Number(value);
      if (number === undefined || !Number.isFinite(number)) {
        throw invalidImport("Google ordinal answer is invalid");
      }
      return { kind: "ordinal", value: number };
    }
    case "text":
      return { kind: "text", value: textValues.join("\n") };
    case "date": {
      const value = textValues[0];
      if (value === undefined) throw invalidImport("Google date answer is invalid");
      return {
        kind: "date",
        value,
        includeTime: question.includeTime,
        includeYear: question.includeYear,
      };
    }
    case "time": {
      const value = textValues[0];
      if (value === undefined) throw invalidImport("Google time answer is invalid");
      return { kind: "time", value, duration: question.duration };
    }
    case "file":
      return { kind: "file", files: fileValues };
    case "unsupported":
      return { kind: "unsupported", values: textValues };
  }
};

const completeAnswerSlots = (
  form: FormSnapshot,
  answered: Readonly<Record<QuestionId, { state: "answered"; value: QuestionAnswerValue }>>,
  path: ReturnType<typeof resolveResponsePath>,
): NormalizedResponse["answers"] => {
  const result: Record<QuestionId, NormalizedResponse["answers"][QuestionId]> = {};
  for (const question of form.questions) {
    const answer = answered[question.id];
    if (answer !== undefined) {
      result[question.id] = answer;
      continue;
    }
    const state = path.questions[question.id];
    if (state === "reached" && !question.required) result[question.id] = { state: "skipped" };
    else if (state === "not_reached") result[question.id] = { state: "not_reached" };
    else result[question.id] = { state: "indeterminate" };
  }
  return result;
};

const textAnswerValues = (raw: RawAnswerRecord): string[] => {
  if (!hasOwn(raw, "textAnswers")) return [];
  const textAnswers = raw.textAnswers;
  if (
    !isRecord(textAnswers) ||
    !hasOwn(textAnswers, "answers") ||
    !Array.isArray(textAnswers.answers)
  ) {
    throw invalidImport("Google text answer is invalid");
  }
  if (textAnswers.answers.length === 0) throw invalidImport("Google text answer is invalid");
  return textAnswers.answers.flatMap((answer) => {
    if (!isRecord(answer) || typeof answer.value !== "string") {
      throw invalidImport("Google text answer is invalid");
    }
    return [answer.value];
  });
};

const fileAnswerValues = (raw: RawAnswerRecord): { fileName?: string; mimeType?: string }[] => {
  if (!hasOwn(raw, "fileUploadAnswers")) return [];
  const fileAnswers = raw.fileUploadAnswers;
  if (
    !isRecord(fileAnswers) ||
    !hasOwn(fileAnswers, "answers") ||
    !Array.isArray(fileAnswers.answers)
  ) {
    throw invalidImport("Google file answer is invalid");
  }
  if (fileAnswers.answers.length === 0) throw invalidImport("Google file answer is invalid");
  return fileAnswers.answers.map((answer) => {
    const record = requireRecord(answer);
    const fileName = strictOptionalString(record, "fileName");
    const mimeType = strictOptionalString(record, "mimeType");
    const fileId = strictOptionalString(record, "fileId");
    if (fileName === undefined && mimeType === undefined && fileId === undefined) {
      throw invalidImport("Google file answer is invalid");
    }
    return {
      ...(fileName === undefined ? {} : { fileName }),
      ...(mimeType === undefined ? {} : { mimeType }),
    };
  });
};

const rowTitle = (question: RecordValue): string => {
  const row = requireRecord(question.rowQuestion);
  return requiredString(row.title, "Grid row title");
};

const addQuestion = (
  state: NormalizationState,
  question: Question,
  sectionDrafts: readonly SectionDraft[],
  sectionId: SectionId,
): void => {
  if (state.questionIds.has(question.id))
    throw invalidImport("Google Form contains duplicate question IDs");
  state.questionIds.add(question.id);
  state.questions.push(question);
  const section = sectionDrafts.find((draft) => draft.section.id === sectionId);
  if (section === undefined) throw invalidImport("Form section could not be resolved");
  section.questionIds.push(question.id);
};

const unsupportedQuestion = (base: QuestionBaseLike, sourceType: string): UnsupportedQuestion => ({
  ...base,
  kind: "unsupported",
  sourceType,
});

type QuestionBaseLike = {
  id: QuestionId;
  title: string;
  description?: string;
  sectionId: SectionId;
  required: boolean;
  affectsNavigation: boolean;
  groupId?: GroupId;
};

const gridPresentation = (value: string): "radio" | "checkbox" => {
  if (value === "RADIO") return "radio";
  if (value === "CHECKBOX") return "checkbox";
  throw invalidImport("Google grid choice type is unsupported");
};

const ratingPresentation = (
  value: string | undefined,
): OrdinalQuestion["presentation"] | undefined => {
  switch (value) {
    case "STAR":
      return "rating_star";
    case "HEART":
      return "rating_heart";
    case "THUMB_UP":
      return "rating_thumb_up";
    default:
      return undefined;
  }
};

const hasRoute = (option: RecordValue): boolean =>
  optionalString(option.goToAction) !== undefined ||
  optionalString(option.goToSectionId) !== undefined;

const schemaHash = (snapshot: Omit<FormSnapshot, "schemaHash"> & { schemaHash: string }): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalSnapshot(snapshot)))
    .digest("hex");

const canonicalSnapshot = (
  snapshot: Omit<FormSnapshot, "schemaHash"> & { schemaHash: string },
): unknown => ({
  formId: snapshot.formId,
  title: snapshot.title,
  description: snapshot.description ?? null,
  sections: snapshot.sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description ?? null,
    order: section.order,
    questionIds: [...section.questionIds],
  })),
  questions: snapshot.questions.map(canonicalQuestion),
  groups: snapshot.groups.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description ?? null,
    kind: group.kind,
    presentation: group.presentation,
    options: group.options.map(canonicalOption),
    questionIds: [...group.questionIds],
    shuffleQuestions: group.shuffleQuestions,
  })),
  logic: {
    entrySectionId: snapshot.logic.entrySectionId,
    sections: snapshot.logic.sections.map((section) => ({
      id: section.id,
      order: section.order,
      questionIds: [...section.questionIds],
      nextSectionId: section.nextSectionId ?? null,
    })),
    transitions: snapshot.logic.transitions.map((transition) => ({
      sourceQuestionId: transition.sourceQuestionId,
      optionKey: transition.optionKey,
      destination: transition.destination,
      evidence: transition.evidence,
    })),
    coverage: snapshot.logic.coverage,
    hasRestartFlow: snapshot.logic.hasRestartFlow,
  },
});

const canonicalQuestion = (question: Question): unknown => {
  const base = {
    id: question.id,
    title: question.title,
    description: question.description ?? null,
    sectionId: question.sectionId,
    required: question.required,
    affectsNavigation: question.affectsNavigation,
    groupId: question.groupId ?? null,
    kind: question.kind,
  };
  switch (question.kind) {
    case "single_choice":
    case "multi_choice":
      return {
        ...base,
        presentation: question.presentation,
        options: question.options.map(canonicalOption),
        shuffle: question.shuffle,
      };
    case "ordinal":
      return {
        ...base,
        presentation: question.presentation,
        min: question.min,
        max: question.max,
        lowLabel: question.lowLabel ?? null,
        highLabel: question.highLabel ?? null,
      };
    case "text":
      return { ...base, presentation: question.presentation };
    case "date":
      return { ...base, includeTime: question.includeTime, includeYear: question.includeYear };
    case "time":
      return { ...base, duration: question.duration };
    case "file":
      return {
        ...base,
        allowedTypes: [...question.allowedTypes],
        maxFiles: question.maxFiles,
        maxFileSizeBytes: question.maxFileSizeBytes ?? null,
      };
    case "unsupported":
      return { ...base, sourceType: question.sourceType };
  }
};

const canonicalOption = (option: ChoiceOption): unknown => ({
  key: option.key,
  label: option.label,
  isOther: option.isOther ?? false,
});

const requireRecord = (value: unknown): RecordValue => {
  if (!isRecord(value)) throw invalidImport("Google Form payload is invalid");
  return value;
};

const asRecord = (value: unknown): RecordValue => requireRecord(value);

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: RecordValue, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) throw invalidImport(`${field} is invalid`);
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  value === undefined
    ? undefined
    : typeof value === "string" && value.length > 0
      ? value
      : undefined;

const strictOptionalString = (record: RecordValue, key: string): string | undefined => {
  if (!hasOwn(record, key)) return undefined;
  if (
    typeof record[key] !== "string" ||
    (key !== "fileName" && key !== "mimeType" && record[key].length === 0)
  ) {
    throw invalidImport("Google response field is invalid");
  }
  return record[key];
};

const validAnswerRecord = (value: unknown, questionId: string): RawAnswerRecord => {
  const record = requireRecord(value);
  if (hasOwn(record, "questionId") && record.questionId !== questionId) {
    throw invalidImport("Google response question ID is invalid");
  }
  const hasText = hasOwn(record, "textAnswers");
  const hasFiles = hasOwn(record, "fileUploadAnswers");
  if (hasText === hasFiles) throw invalidImport("Google response answer shape is invalid");
  if (hasText) {
    const textAnswers = requireRecord(record.textAnswers);
    if (!hasOwn(textAnswers, "answers") || !Array.isArray(textAnswers.answers)) {
      throw invalidImport("Google text answer is invalid");
    }
    if (textAnswers.answers.length === 0) throw invalidImport("Google text answer is invalid");
    for (const answer of textAnswers.answers) {
      const answerRecord = requireRecord(answer);
      if (typeof answerRecord.value !== "string") {
        throw invalidImport("Google text answer is invalid");
      }
    }
    return record;
  }
  const fileAnswers = requireRecord(record.fileUploadAnswers);
  if (!hasOwn(fileAnswers, "answers") || !Array.isArray(fileAnswers.answers)) {
    throw invalidImport("Google file answer is invalid");
  }
  if (fileAnswers.answers.length === 0) throw invalidImport("Google file answer is invalid");
  for (const answer of fileAnswers.answers) {
    const answerRecord = requireRecord(answer);
    const fileId = strictOptionalString(answerRecord, "fileId");
    const fileName = strictOptionalString(answerRecord, "fileName");
    const mimeType = strictOptionalString(answerRecord, "mimeType");
    if (fileId === undefined && fileName === undefined && mimeType === undefined) {
      throw invalidImport("Google file answer is invalid");
    }
  }
  return record;
};

const optionalBoolean = (value: unknown): boolean | undefined =>
  value === undefined ? undefined : typeof value === "boolean" ? value : undefined;

const optionalFiniteNumber = (value: unknown): number | undefined =>
  value === undefined
    ? undefined
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;

const requiredFiniteNumber = (value: unknown, field: string): number => {
  const number = optionalFiniteNumber(value);
  if (number === undefined) throw invalidImport(`${field} is invalid`);
  return number;
};

const optionalStringArray = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidImport("Google file type metadata is invalid");
  }
  return [...value];
};

const invalidImport = (message: string): ReturnType<typeof sidecarError> =>
  sidecarError("VALIDATION_FAILED", message, true);
