import { createHash } from "node:crypto";

import {
  resolveResponsePath,
  type AnswerValue,
  type ChoiceOption,
  type FormId,
  type FormLogic,
  type FormSnapshot,
  type GroupId,
  type LogicDestination,
  type LogicTransition,
  type NormalizedResponse,
  type OptionKey,
  type OrdinalQuestion,
  type Question,
  type QuestionGroup,
  type QuestionId,
  type Section,
  type SectionId,
  type SectionNode,
  type UnsupportedQuestion,
} from "@survey-synth/domain";

import { backendFailure } from "../errors";

const ENTRY_SECTION_RAW_ID = "__entry__";

type JsonRecord = Record<string, unknown>;

type QuestionBase = {
  id: QuestionId;
  title: string;
  description?: string;
  sectionId: SectionId;
  required: boolean;
  affectsNavigation: boolean;
  groupId?: GroupId;
};

type RoutingCandidate = {
  sourceQuestionId: QuestionId;
  optionKey: OptionKey;
  goToAction?: string;
  goToSectionId?: string;
};

type NormalizationState = {
  questions: Question[];
  groups: QuestionGroup[];
  routing: RoutingCandidate[];
  questionIds: Set<string>;
};

const asFormId = (value: string): FormId => value as FormId;
const asSectionId = (value: string): SectionId => value as SectionId;
const asQuestionId = (value: string): QuestionId => value as QuestionId;
const asGroupId = (value: string): GroupId => value as GroupId;

export class GoogleFormNormalizer {
  public normalize(raw: unknown, capturedAt = new Date().toISOString()): FormSnapshot {
    const form = record(raw, "Google Form payload is invalid");
    const formId = requiredString(form.formId, "Google Form ID is invalid");
    const info = record(form.info, "Google Form info is invalid");
    const title = requiredString(info.title, "Google Form title is invalid");
    const items = array(form.items, "Google Form items are invalid");

    const sections = buildSections(items);
    const sectionByRawId = new Map(sections.map((section) => [section.rawId, section.value.id]));
    const state: NormalizationState = {
      questions: [],
      groups: [],
      routing: [],
      questionIds: new Set(),
    };

    let currentSection = sections[0];
    if (!currentSection) throw invalidImport("Google Form entry section is missing");

    for (const rawItem of items) {
      const item = record(rawItem, "Google Form item is invalid");
      if (item.pageBreakItem !== undefined) {
        const rawSectionId = requiredString(item.itemId, "Google section ID is invalid");
        currentSection = sections.find((section) => section.rawId === rawSectionId);
        if (!currentSection) throw invalidImport("Google section could not be resolved");
        continue;
      }

      if (item.questionItem !== undefined) {
        const questionItem = record(item.questionItem, "Google question item is invalid");
        const question = normalizeQuestion(
          questionItem.question,
          item,
          currentSection.value.id,
          undefined,
          state,
        );
        addQuestion(state, currentSection, question);
      }

      if (item.questionGroupItem !== undefined) {
        const group = normalizeQuestionGroup(
          item.questionGroupItem,
          item,
          currentSection,
          state,
        );
        state.groups.push(group);
      }
    }

    const sectionValues = sections.map((section) => ({
      ...section.value,
      questionIds: [...section.questionIds],
    }));
    const transitions = buildTransitions(state.routing, sectionByRawId);
    const navigationQuestions = new Set(transitions.map((transition) => transition.sourceQuestionId));
    const questions = state.questions.map((question) =>
      navigationQuestions.has(question.id) ? { ...question, affectsNavigation: true } : question,
    );
    const logic: FormLogic = {
      entrySectionId: asSectionId(ENTRY_SECTION_RAW_ID),
      sections: buildSectionNodes(sectionValues),
      transitions,
      coverage: state.routing.length === 0 ? "none" : "partial",
      hasRestartFlow: transitions.some((transition) => transition.destination.type === "restart"),
    };

    const snapshotWithoutHash: FormSnapshot = {
      formId: asFormId(formId),
      title,
      ...(optionalString(info.description) ? { description: optionalString(info.description) } : {}),
      capturedAt,
      schemaHash: "",
      sections: sectionValues,
      questions,
      groups: state.groups,
      logic,
    };

    return {
      ...snapshotWithoutHash,
      schemaHash: hashFormSnapshot(snapshotWithoutHash),
    };
  }
}

export class GoogleResponseNormalizer {
  public normalizeAll(form: FormSnapshot, rawResponses: readonly unknown[]): NormalizedResponse[] {
    const questions = new Map(form.questions.map((question) => [question.id as string, question]));

    return rawResponses.map((rawResponse) => {
      const response = record(rawResponse, "Google response is invalid");
      const responseId = requiredString(response.responseId, "Google response ID is invalid");
      const rawAnswers = response.answers === undefined ? {} : record(response.answers, "Google response answers are invalid");
      const answered: Record<QuestionId, { state: "answered"; value: AnswerValue }> = {};

      for (const [rawQuestionId, rawAnswer] of Object.entries(rawAnswers)) {
        const question = questions.get(rawQuestionId);
        if (!question) continue;
        const value = normalizeAnswer(question, rawAnswer);
        if (value !== undefined) answered[question.id] = { state: "answered", value };
      }

      const path = resolveResponsePath(form, answered);
      return {
        responseId: responseId as NormalizedResponse["responseId"],
        ...(optionalString(response.createTime) ? { createdAt: optionalString(response.createTime) } : {}),
        ...(optionalString(response.lastSubmittedTime)
          ? { lastSubmittedAt: optionalString(response.lastSubmittedTime) }
          : {}),
        answers: completeAnswerSlots(form, answered, path),
        origin: "original",
        path,
      };
    });
  }
}

type SectionDraft = {
  rawId: string;
  value: Section;
  questionIds: QuestionId[];
};

const buildSections = (items: readonly unknown[]): SectionDraft[] => {
  const sections: SectionDraft[] = [
    {
      rawId: ENTRY_SECTION_RAW_ID,
      value: {
        id: asSectionId(ENTRY_SECTION_RAW_ID),
        title: "",
        order: 0,
        questionIds: [],
      },
      questionIds: [],
    },
  ];
  const ids = new Set([ENTRY_SECTION_RAW_ID]);

  for (const rawItem of items) {
    const item = record(rawItem, "Google Form item is invalid");
    if (item.pageBreakItem === undefined) continue;
    const rawId = requiredString(item.itemId, "Google section ID is invalid");
    if (ids.has(rawId)) throw invalidImport("Google Form contains duplicate section IDs");
    ids.add(rawId);
    const description = optionalString(item.description);
    sections.push({
      rawId,
      value: {
        id: asSectionId(rawId),
        title: optionalString(item.title) ?? "",
        ...(description ? { description } : {}),
        order: sections.length,
        questionIds: [],
      },
      questionIds: [],
    });
  }

  return sections;
};

const normalizeQuestionGroup = (
  rawGroup: unknown,
  item: JsonRecord,
  section: SectionDraft,
  state: NormalizationState,
): QuestionGroup => {
  const group = record(rawGroup, "Google grid is invalid");
  const rawGroupId = requiredString(item.itemId, "Google grid ID is invalid");
  const grid = record(group.grid, "Google grid metadata is invalid");
  const columns = record(grid.columns, "Google grid columns are invalid");
  const type = requiredString(columns.type, "Google grid choice type is invalid");
  const presentation = type === "RADIO" ? "radio" : type === "CHECKBOX" ? "checkbox" : undefined;
  if (!presentation) throw invalidImport("Google grid choice type is unsupported");
  const options = normalizeOptions(columns.options, `group:${rawGroupId}`, undefined, false);
  const rawQuestions = array(group.questions, "Google grid rows are invalid");
  const questionIds: QuestionId[] = [];

  for (const rawQuestion of rawQuestions) {
    const question = normalizeQuestion(
      rawQuestion,
      item,
      section.value.id,
      { groupId: asGroupId(rawGroupId), presentation, options },
      state,
    );
    addQuestion(state, section, question);
    questionIds.push(question.id);
  }

  const description = optionalString(item.description);
  return {
    id: asGroupId(rawGroupId),
    title: optionalString(item.title) ?? "",
    ...(description ? { description } : {}),
    kind: "grid",
    presentation,
    options,
    questionIds,
    shuffleQuestions: grid.shuffleQuestions === true,
  };
};

type GridContext = {
  groupId: GroupId;
  presentation: "radio" | "checkbox";
  options: readonly ChoiceOption[];
};

const normalizeQuestion = (
  rawQuestion: unknown,
  item: JsonRecord,
  sectionId: SectionId,
  grid: GridContext | undefined,
  state: NormalizationState,
): Question => {
  const question = record(rawQuestion, "Google question is invalid");
  const rawQuestionId = requiredString(question.questionId, "Google question ID is invalid");
  const id = asQuestionId(rawQuestionId);
  const description = grid ? undefined : optionalString(item.description);
  const base: QuestionBase = {
    id,
    title: grid ? rowTitle(question) : (optionalString(item.title) ?? ""),
    ...(description ? { description } : {}),
    sectionId,
    required: question.required === true,
    affectsNavigation: false,
    ...(grid ? { groupId: grid.groupId } : {}),
  };

  if (grid) {
    if (question.rowQuestion === undefined) return unsupportedQuestion(base, "gridRow");
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

  const kinds = [
    "choiceQuestion",
    "textQuestion",
    "scaleQuestion",
    "dateQuestion",
    "timeQuestion",
    "fileUploadQuestion",
    "ratingQuestion",
  ].filter((key) => question[key] !== undefined);
  if (kinds.length !== 1) return unsupportedQuestion(base, kinds[0] ?? "unknown");

  switch (kinds[0]) {
    case "choiceQuestion": {
      const choice = record(question.choiceQuestion, "Google choice question is invalid");
      const type = requiredString(choice.type, "Google choice type is invalid");
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
      const text = record(question.textQuestion, "Google text question is invalid");
      return {
        ...base,
        kind: "text",
        presentation: text.paragraph === true ? "paragraph" : "short",
      };
    }
    case "scaleQuestion": {
      const scale = record(question.scaleQuestion, "Google scale question is invalid");
      const min = finiteNumber(scale.low, "Google scale lower bound is invalid");
      const max = finiteNumber(scale.high, "Google scale upper bound is invalid");
      if (max < min) throw invalidImport("Google scale bounds are invalid");
      const lowLabel = optionalString(scale.lowLabel);
      const highLabel = optionalString(scale.highLabel);
      return {
        ...base,
        kind: "ordinal",
        presentation: "linear_scale",
        min,
        max,
        ...(lowLabel ? { lowLabel } : {}),
        ...(highLabel ? { highLabel } : {}),
      };
    }
    case "dateQuestion": {
      const date = record(question.dateQuestion, "Google date question is invalid");
      return {
        ...base,
        kind: "date",
        includeTime: date.includeTime === true,
        includeYear: date.includeYear === true,
      };
    }
    case "timeQuestion": {
      const time = record(question.timeQuestion, "Google time question is invalid");
      return { ...base, kind: "time", duration: time.duration === true };
    }
    case "fileUploadQuestion": {
      const file = record(question.fileUploadQuestion, "Google file question is invalid");
      const allowedTypes = stringArray(file.types, "Google file type metadata is invalid");
      const maxFiles = file.maxFiles === undefined ? 1 : finiteNumber(file.maxFiles, "Google file count is invalid");
      if (!Number.isInteger(maxFiles) || maxFiles < 1) throw invalidImport("Google file count is invalid");
      const maxFileSizeBytes = optionalString(file.maxFileSize);
      return {
        ...base,
        kind: "file",
        allowedTypes,
        maxFiles,
        ...(maxFileSizeBytes ? { maxFileSizeBytes } : {}),
      };
    }
    case "ratingQuestion": {
      const rating = record(question.ratingQuestion, "Google rating question is invalid");
      const max = finiteNumber(rating.ratingScaleLevel, "Google rating scale is invalid");
      const presentation = ratingPresentation(optionalString(rating.iconType));
      if (!presentation || max < 1) return unsupportedQuestion(base, "ratingQuestion");
      return { ...base, kind: "ordinal", presentation, min: 1, max };
    }
    default:
      return unsupportedQuestion(base, kinds[0] ?? "unknown");
  }
};

const normalizeOptions = (
  rawOptions: unknown,
  scope: string,
  routing: { sourceQuestionId: QuestionId; state: NormalizationState } | undefined,
  allowNavigation: boolean,
): ChoiceOption[] => {
  const options = array(rawOptions, "Google choice options are invalid");
  return options.map((rawOption, index) => {
    const option = record(rawOption, "Google choice option is invalid");
    const isOther = option.isOther === true;
    const label =
      typeof option.value === "string"
        ? option.value
        : option.value === undefined && isOther
          ? "Other"
          : undefined;
    if (label === undefined) throw invalidImport("Google choice option value is invalid");
    const key = `option:${scope}:${index}` as OptionKey;

    if (routing && allowNavigation) {
      const goToAction = optionalString(option.goToAction);
      const goToSectionId = optionalString(option.goToSectionId);
      if (goToAction || goToSectionId) {
        routing.state.routing.push({
          sourceQuestionId: routing.sourceQuestionId,
          optionKey: key,
          ...(goToAction ? { goToAction } : {}),
          ...(goToSectionId ? { goToSectionId } : {}),
        });
      }
    }

    return { key, label, ...(isOther ? { isOther: true } : {}) };
  });
};

const buildSectionNodes = (sections: readonly Section[]): SectionNode[] =>
  sections.map((section, index) => ({
    id: section.id,
    order: section.order,
    questionIds: section.questionIds,
    ...(sections[index + 1] ? { nextSectionId: sections[index + 1]!.id } : {}),
  }));

const buildTransitions = (
  candidates: readonly RoutingCandidate[],
  sectionByRawId: ReadonlyMap<string, SectionId>,
): LogicTransition[] =>
  candidates.flatMap((candidate) => {
    const destination = routeDestination(candidate, sectionByRawId);
    if (!destination) return [];
    return [
      {
        sourceQuestionId: candidate.sourceQuestionId,
        optionKey: candidate.optionKey,
        destination,
        evidence: "api_confirmed" as const,
      },
    ];
  });

const routeDestination = (
  candidate: RoutingCandidate,
  sectionByRawId: ReadonlyMap<string, SectionId>,
): LogicDestination | undefined => {
  if (candidate.goToSectionId) {
    const sectionId = sectionByRawId.get(candidate.goToSectionId);
    if (!sectionId) throw invalidImport("Google branch destination section is invalid");
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

const normalizeAnswer = (question: Question, rawAnswer: unknown): AnswerValue | undefined => {
  const answer = record(rawAnswer, "Google answer is invalid");
  const textValues = extractTextValues(answer);
  const files = extractFiles(answer);
  if (textValues.length === 0 && files.length === 0) return undefined;

  switch (question.kind) {
    case "single_choice": {
      const rawValue = textValues[0];
      if (rawValue === undefined) throw invalidImport("Google choice answer is invalid");
      const match = matchOption(question.options, rawValue);
      if (match) {
        return {
          kind: "single_choice",
          optionKey: match.key,
          label: rawValue,
          ...(match.isOther && rawValue !== match.label ? { otherValue: rawValue } : {}),
        };
      }
      const other = uniqueOtherOption(question.options);
      if (!other) throw invalidImport("Google choice answer is not in Form options");
      return {
        kind: "single_choice",
        optionKey: other.key,
        label: rawValue,
        otherValue: rawValue,
      };
    }
    case "multi_choice": {
      let otherValue: string | undefined;
      const optionKeys = textValues.map((rawValue) => {
        const match = matchOption(question.options, rawValue);
        if (match) {
          if (match.isOther && rawValue !== match.label) {
            if (otherValue !== undefined) throw invalidImport("Google checkbox Other answer is ambiguous");
            otherValue = rawValue;
          }
          return match.key;
        }
        const other = uniqueOtherOption(question.options);
        if (!other || otherValue !== undefined) {
          throw invalidImport("Google checkbox answer is not in Form options");
        }
        otherValue = rawValue;
        return other.key;
      });
      if (new Set(optionKeys).size !== optionKeys.length) {
        throw invalidImport("Google checkbox answer contains duplicate options");
      }
      return {
        kind: "multi_choice",
        optionKeys,
        labels: textValues,
        ...(otherValue ? { otherValue } : {}),
      };
    }
    case "ordinal": {
      const value = Number(textValues[0]);
      if (!Number.isFinite(value)) throw invalidImport("Google ordinal answer is invalid");
      return { kind: "ordinal", value };
    }
    case "text":
      return { kind: "text", value: textValues.join("\n") };
    case "date": {
      const value = textValues[0];
      if (!value) throw invalidImport("Google date answer is invalid");
      return {
        kind: "date",
        value,
        includeTime: question.includeTime,
        includeYear: question.includeYear,
      };
    }
    case "time": {
      const value = textValues[0];
      if (!value) throw invalidImport("Google time answer is invalid");
      return { kind: "time", value, duration: question.duration };
    }
    case "file":
      return { kind: "file", files };
    case "unsupported":
      return {
        kind: "unsupported",
        values: [...textValues, ...files.map((file) => file.fileName ?? file.mimeType ?? "file")],
      };
  }
};

const completeAnswerSlots = (
  form: FormSnapshot,
  answered: Readonly<Record<QuestionId, { state: "answered"; value: AnswerValue }>>,
  path: ReturnType<typeof resolveResponsePath>,
): NormalizedResponse["answers"] => {
  const result: Record<QuestionId, NormalizedResponse["answers"][QuestionId]> = {};
  for (const question of form.questions) {
    const answer = answered[question.id];
    if (answer) {
      result[question.id] = answer;
      continue;
    }
    const reachability = path.questions[question.id];
    if (reachability === "reached" && !question.required) result[question.id] = { state: "skipped" };
    else if (reachability === "not_reached") result[question.id] = { state: "not_reached" };
    else result[question.id] = { state: "indeterminate" };
  }
  return result;
};

const extractTextValues = (answer: JsonRecord): string[] => {
  if (answer.textAnswers === undefined) return [];
  const textAnswers = record(answer.textAnswers, "Google text answer is invalid");
  return array(textAnswers.answers, "Google text answer is invalid").map((raw) => {
    const value = record(raw, "Google text answer is invalid").value;
    if (typeof value !== "string") throw invalidImport("Google text answer is invalid");
    return value;
  });
};

const extractFiles = (answer: JsonRecord): { fileName?: string; mimeType?: string }[] => {
  if (answer.fileUploadAnswers === undefined) return [];
  const fileAnswers = record(answer.fileUploadAnswers, "Google file answer is invalid");
  return array(fileAnswers.answers, "Google file answer is invalid").map((raw) => {
    const file = record(raw, "Google file answer is invalid");
    const fileName = optionalString(file.fileName);
    const mimeType = optionalString(file.mimeType);
    if (!fileName && !mimeType && !optionalString(file.fileId)) {
      throw invalidImport("Google file answer is invalid");
    }
    return {
      ...(fileName ? { fileName } : {}),
      ...(mimeType ? { mimeType } : {}),
    };
  });
};

const matchOption = (options: readonly ChoiceOption[], rawValue: string): ChoiceOption | undefined => {
  const normalized = rawValue.normalize("NFKC").trim();
  const matches = options.filter((option) => option.label.normalize("NFKC").trim() === normalized);
  if (matches.length > 1) throw invalidImport("Google choice answer is ambiguous");
  return matches[0];
};

const uniqueOtherOption = (options: readonly ChoiceOption[]): ChoiceOption | undefined => {
  const others = options.filter((option) => option.isOther === true);
  return others.length === 1 ? others[0] : undefined;
};

const addQuestion = (state: NormalizationState, section: SectionDraft, question: Question): void => {
  if (state.questionIds.has(question.id as string)) {
    throw invalidImport("Google Form contains duplicate question IDs");
  }
  state.questionIds.add(question.id as string);
  state.questions.push(question);
  section.questionIds.push(question.id);
};

const unsupportedQuestion = (base: QuestionBase, sourceType: string): UnsupportedQuestion => ({
  ...base,
  kind: "unsupported",
  sourceType,
});

const rowTitle = (question: JsonRecord): string => {
  const row = record(question.rowQuestion, "Google grid row is invalid");
  return requiredString(row.title, "Google grid row title is invalid");
};

const ratingPresentation = (
  iconType: string | undefined,
): OrdinalQuestion["presentation"] | undefined => {
  switch (iconType) {
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

const hashFormSnapshot = (snapshot: FormSnapshot): string =>
  createHash("sha256").update(JSON.stringify(canonicalForm(snapshot))).digest("hex");

const canonicalForm = (snapshot: FormSnapshot): unknown => ({
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

const record = (value: unknown, message: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidImport(message);
  return value as JsonRecord;
};

const array = (value: unknown, message: string): unknown[] => {
  if (!Array.isArray(value)) throw invalidImport(message);
  return value;
};

const requiredString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || value.length === 0) throw invalidImport(message);
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const finiteNumber = (value: unknown, message: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidImport(message);
  return value;
};

const stringArray = (value: unknown, message: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidImport(message);
  }
  return [...value];
};

const invalidImport = (message: string): ReturnType<typeof backendFailure> =>
  backendFailure("VALIDATION_FAILED", message);
