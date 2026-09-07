import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { parquetWriteFile } from "hyparquet-writer";

import {
  resolveResponsePath,
  type AnswerSlot,
  type FormSnapshot,
  type MultiChoiceQuestion,
  type NormalizedResponse,
  type QuestionId,
} from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { StoredSourceResponse } from "../persistence/store";

export const RESPONSE_ID_COLUMN = "response_id";
export const TIMESTAMP_COLUMN = "submitted_at";
export const TARGET_SCORE_COLUMN_PREFIX = "target_score_";
export const ROUTING_RULES_COLUMN = "__confirmed_routing_rules";
const ORIGIN_COLUMN = "__origin";

export type FlatTablePlan = {
  targetScoreColumns: ReadonlyMap<QuestionId, string>;
  questionColumns: ReadonlyMap<QuestionId, string>;
};

export type DecodedRunRow = {
  responseId: string;
  submittedAtMs: number;
  origin: "original" | "synthetic";
  response: NormalizedResponse;
};

export type MultiChoiceOptionSupport = {
  optionValues: string[];
  schemaOptionValues: string[];
};

type ParquetRecord = Record<string, unknown>;
type CandidateRoutingColumn = {
  column: string;
  kind: "answer_slot" | "ordinal";
};
type CandidateRoutingRule = {
  sourceColumn: string;
  optionKey: string;
  forbidden: CandidateRoutingColumn[];
};

const asNormalizedResponse = (value: unknown): NormalizedResponse => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw backendFailure("INTERNAL", "Stored normalized response is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.responseId !== "string" ||
    typeof record.answers !== "object" ||
    record.answers === null
  ) {
    throw backendFailure("INTERNAL", "Stored normalized response is invalid");
  }
  return value as NormalizedResponse;
};

const targetScore = (response: NormalizedResponse, questionId: QuestionId): number | null => {
  const slot = response.answers[questionId];
  if (!slot) {
    throw backendFailure("INTERNAL", `Stored response is missing question ${questionId}`);
  }
  if (slot.state !== "answered") return null;
  if (slot.value.kind !== "ordinal") {
    throw backendFailure("INTERNAL", `Stored response has a non-ordinal value for ${questionId}`);
  }
  return slot.value.value;
};

export const createFlatTablePlan = (
  form: FormSnapshot,
  targetQuestionIds: readonly QuestionId[],
): FlatTablePlan => {
  const targetIds = new Set(targetQuestionIds);
  const targetScoreColumns = new Map<QuestionId, string>();
  const questionColumns = new Map<QuestionId, string>();
  let index = 0;
  let scoreIndex = 0;
  for (const question of form.questions) {
    if (targetIds.has(question.id)) {
      targetScoreColumns.set(question.id, `${TARGET_SCORE_COLUMN_PREFIX}${scoreIndex}`);
      scoreIndex += 1;
      continue;
    }
    questionColumns.set(question.id, `q_${index}`);
    index += 1;
  }
  return { targetScoreColumns, questionColumns };
};

const valueGroupMemberKey = (slot: AnswerSlot | undefined): string | null => {
  if (slot?.state !== "answered") return null;
  if (slot.value.kind === "single_choice") return String(slot.value.optionKey);
  if (slot.value.kind === "text") return slot.value.value;
  return null;
};

export const valueGroupMemberCells = (
  responses: readonly StoredSourceResponse[],
  questionId: QuestionId,
  members: readonly string[],
  form: FormSnapshot,
): string[] => {
  const memberSet = new Set(members);
  const cells = new Set<string>();
  for (const stored of responses) {
    const slot = asNormalizedResponse(stored.response).answers[questionId];
    const key = valueGroupMemberKey(slot);
    if (key !== null && memberSet.has(key) && slot) cells.add(JSON.stringify(slot));
  }

  const question = form.questions.find((candidate) => candidate.id === questionId);
  if (question?.kind === "single_choice") {
    for (const option of question.options) {
      if (!memberSet.has(String(option.key))) continue;
      const canonical: AnswerSlot = {
        state: "answered",
        value: {
          kind: "single_choice",
          optionKey: option.key,
          label: option.label,
        },
      };
      cells.add(JSON.stringify(canonical));
    }
  }
  return [...cells];
};

export const multiChoiceOptionCells = (
  responses: readonly StoredSourceResponse[],
  questionId: QuestionId,
  optionKey: string,
): string[] => {
  const cells = new Set<string>();
  for (const stored of responses) {
    const slot = asNormalizedResponse(stored.response).answers[questionId];
    if (
      slot?.state === "answered" &&
      slot.value.kind === "multi_choice" &&
      slot.value.optionKeys.some((key) => String(key) === optionKey)
    ) {
      cells.add(JSON.stringify(slot));
    }
  }
  return [...cells];
};

export const multiChoiceOptionSupport = (
  responses: readonly StoredSourceResponse[],
  question: MultiChoiceQuestion,
  optionKey: string,
): MultiChoiceOptionSupport => {
  const observed = multiChoiceOptionCells(responses, question.id, optionKey);
  if (observed.length > 0) {
    return { optionValues: observed, schemaOptionValues: [] };
  }

  const option = question.options.find((candidate) => String(candidate.key) === optionKey);
  if (!option) return { optionValues: [], schemaOptionValues: [] };

  const canonical: AnswerSlot = {
    state: "answered",
    value: {
      kind: "multi_choice",
      optionKeys: [option.key],
      labels: [option.label],
    },
  };
  const cell = JSON.stringify(canonical);
  return { optionValues: [cell], schemaOptionValues: [cell] };
};

const candidateColumn = (
  plan: FlatTablePlan,
  questionId: QuestionId,
): CandidateRoutingColumn | null => {
  const scoreColumn = plan.targetScoreColumns.get(questionId);
  if (scoreColumn) return { column: scoreColumn, kind: "ordinal" };
  const answerColumn = plan.questionColumns.get(questionId);
  return answerColumn ? { column: answerColumn, kind: "answer_slot" } : null;
};

const confirmedRoutingRules = (
  form: FormSnapshot,
  plan: FlatTablePlan,
): CandidateRoutingRule[] => {
  const sectionByQuestion = new Map(
    form.logic.sections.flatMap((section) =>
      section.questionIds.map((questionId) => [questionId, section] as const),
    ),
  );
  const sectionById = new Map(
    form.logic.sections.map((section) => [section.id, section] as const),
  );
  const rules: CandidateRoutingRule[] = [];

  for (const transition of form.logic.transitions) {
    const sourceSection = sectionByQuestion.get(transition.sourceQuestionId);
    const sourceColumn = plan.questionColumns.get(transition.sourceQuestionId);
    if (!sourceSection || !sourceColumn) continue;

    let notReachedSectionIds = new Set<string>();
    if (transition.destination.type === "submit") {
      notReachedSectionIds = new Set(
        form.logic.sections
          .filter((section) => section.order > sourceSection.order)
          .map((section) => String(section.id)),
      );
    } else if (transition.destination.type === "section") {
      const destination = sectionById.get(transition.destination.sectionId);
      if (!destination || destination.order <= sourceSection.order) continue;
      notReachedSectionIds = new Set(
        form.logic.sections
          .filter(
            (section) => section.order > sourceSection.order && section.order < destination.order,
          )
          .map((section) => String(section.id)),
      );
    } else {
      continue;
    }

    const forbidden = form.questions.flatMap((question) => {
      if (!notReachedSectionIds.has(String(question.sectionId))) return [];
      const column = candidateColumn(plan, question.id);
      return column ? [column] : [];
    });
    if (forbidden.length === 0) continue;
    rules.push({
      sourceColumn,
      optionKey: String(transition.optionKey),
      forbidden,
    });
  }

  return rules;
};

export const writeSourceParquet = async (
  path: string,
  form: FormSnapshot,
  responses: readonly StoredSourceResponse[],
  plan: FlatTablePlan,
): Promise<void> => {
  const normalized = responses.map((stored) => ({
    stored,
    response: asNormalizedResponse(stored.response),
  }));

  const questionColumns = [...plan.questionColumns].map(([questionId, column]) => ({
    name: column,
    data: normalized.map(({ response }) => {
      const slot = response.answers[questionId];
      if (!slot) {
        throw backendFailure("INTERNAL", `Stored response is missing question ${questionId}`);
      }
      return JSON.stringify(slot);
    }),
    type: "STRING" as const,
    nullable: false,
  }));
  const routingRules = JSON.stringify(confirmedRoutingRules(form, plan));

  parquetWriteFile({
    filename: path,
    columnData: [
      {
        name: RESPONSE_ID_COLUMN,
        data: normalized.map(({ stored }) => stored.responseId),
        type: "STRING" as const,
        nullable: false,
      },
      {
        name: TIMESTAMP_COLUMN,
        data: normalized.map(({ stored }) => new Date(stored.submittedAtMs).toISOString()),
        type: "STRING" as const,
        nullable: false,
      },
      {
        name: ROUTING_RULES_COLUMN,
        data: normalized.map(() => routingRules),
        type: "STRING" as const,
        nullable: false,
      },
      ...[...plan.targetScoreColumns].map(([questionId, column]) => ({
        name: column,
        data: normalized.map(({ response }) => targetScore(response, questionId)),
        type: "DOUBLE" as const,
        nullable: true,
      })),
      ...questionColumns,
    ],
  });
};

const parseGeneratedSlot = (value: unknown, questionId: QuestionId): AnswerSlot => {
  if (typeof value !== "string") {
    throw backendFailure("INTERNAL", `Synthetic row is missing question ${questionId}`);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const state = (parsed as Record<string, unknown>).state;
    if (!["answered", "skipped", "not_reached", "indeterminate"].includes(String(state))) {
      throw new Error();
    }
    return parsed as AnswerSlot;
  } catch {
    throw backendFailure("INTERNAL", `Synthetic row contains invalid question ${questionId}`);
  }
};

const timestampMs = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Date.parse(value);
  return NaN;
};

const stringValue = (value: unknown, field: string): string => {
  if (typeof value === "string" && value.length > 0) return value;
  throw backendFailure("INTERNAL", `Synthetic result has invalid ${field}`);
};

const confirmedNotReachedQuestions = (
  form: FormSnapshot,
  answers: Readonly<Record<QuestionId, AnswerSlot>>,
): ReadonlySet<QuestionId> => {
  const sectionByQuestion = new Map(
    form.logic.sections.flatMap((section) =>
      section.questionIds.map((questionId) => [questionId, section] as const),
    ),
  );
  const transitions = new Map(
    form.logic.transitions.map(
      (transition) =>
        [
          `${String(transition.sourceQuestionId)}\0${String(transition.optionKey)}`,
          transition,
        ] as const,
    ),
  );
  const notReachedSections = new Set<string>();

  for (const [questionId, slot] of Object.entries(answers)) {
    if (slot.state !== "answered" || slot.value.kind !== "single_choice") continue;
    const transition = transitions.get(`${questionId}\0${String(slot.value.optionKey)}`);
    if (!transition) continue;
    const sourceSection = sectionByQuestion.get(questionId as QuestionId);
    if (!sourceSection) continue;

    if (transition.destination.type === "submit") {
      for (const section of form.logic.sections) {
        if (section.order > sourceSection.order) notReachedSections.add(String(section.id));
      }
      continue;
    }
    if (transition.destination.type !== "section") continue;
    const destinationSectionId = transition.destination.sectionId;
    const destination = form.logic.sections.find((section) => section.id === destinationSectionId);
    if (!destination || destination.order <= sourceSection.order) continue;
    for (const section of form.logic.sections) {
      if (section.order > sourceSection.order && section.order < destination.order) {
        notReachedSections.add(String(section.id));
      }
    }
  }

  return new Set(
    form.questions
      .filter((question) => notReachedSections.has(String(question.sectionId)))
      .map((question) => question.id),
  );
};

const validateConfirmedRouting = (
  form: FormSnapshot,
  provisional: Readonly<Record<QuestionId, AnswerSlot>>,
): void => {
  const notReached = confirmedNotReachedQuestions(form, provisional);
  for (const questionId of notReached) {
    if (provisional[questionId]?.state === "answered") {
      const question = form.questions.find((candidate) => candidate.id === questionId);
      throw backendFailure(
        "TARGET_CONFLICT",
        `Generated candidate answered a confirmed not-reached question: ${question?.title || questionId}`,
      );
    }
  }
};

const syntheticResponse = (
  form: FormSnapshot,
  plan: FlatTablePlan,
  row: ParquetRecord,
  responseId: string,
  submittedAtMs: number,
): NormalizedResponse => {
  const provisional = {} as Record<QuestionId, AnswerSlot>;
  for (const [questionId, column] of plan.targetScoreColumns) {
    const scoreValue = row[column];
    if (
      scoreValue === null ||
      scoreValue === undefined ||
      (typeof scoreValue === "number" && Number.isNaN(scoreValue))
    ) {
      provisional[questionId] = { state: "skipped" };
      continue;
    }
    const score = typeof scoreValue === "number" ? scoreValue : Number(scoreValue);
    if (!Number.isFinite(score) || !Number.isInteger(score))
      throw backendFailure("INTERNAL", "Synthetic result contains an invalid ordinal score");
    provisional[questionId] = { state: "answered", value: { kind: "ordinal", value: score } };
  }

  for (const [questionId, column] of plan.questionColumns) {
    provisional[questionId] = parseGeneratedSlot(row[column], questionId);
  }

  validateConfirmedRouting(form, provisional);
  const path = resolveResponsePath(form, provisional);
  const answers = {} as Record<QuestionId, AnswerSlot>;
  for (const question of form.questions) {
    const slot = provisional[question.id];
    if (!slot)
      throw backendFailure("INTERNAL", `Synthetic result is missing question ${question.id}`);
    if (slot.state === "answered") {
      answers[question.id] = slot;
      continue;
    }

    const reachability = path.questions[question.id];
    const state: AnswerSlot["state"] =
      reachability === "reached"
        ? "skipped"
        : reachability === "not_reached"
          ? "not_reached"
          : "indeterminate";
    if (question.required && state === "skipped") {
      throw backendFailure(
        "TARGET_CONFLICT",
        `Generated candidate skipped required question: ${question.title || question.id}`,
      );
    }
    answers[question.id] = { state } as AnswerSlot;
  }

  return {
    responseId: responseId as NormalizedResponse["responseId"],
    createdAt: new Date(submittedAtMs).toISOString(),
    lastSubmittedAt: new Date(submittedAtMs).toISOString(),
    answers,
    origin: "synthetic",
    path,
  };
};

export const readResultParquet = async (
  path: string,
  form: FormSnapshot,
  sourceResponses: readonly StoredSourceResponse[],
  plan: FlatTablePlan,
): Promise<DecodedRunRow[]> => {
  const originals = new Map(
    sourceResponses.map(
      (stored) => [stored.responseId, asNormalizedResponse(stored.response)] as const,
    ),
  );
  const rows = (await parquetReadObjects({
    file: await asyncBufferFromFile(path),
  })) as ParquetRecord[];
  return rows.map((row) => {
    const responseId = stringValue(row[RESPONSE_ID_COLUMN], "response_id");
    const submittedAtMs = timestampMs(row[TIMESTAMP_COLUMN]);
    if (!Number.isFinite(submittedAtMs)) {
      throw backendFailure("INTERNAL", "Synthetic result contains an invalid timestamp");
    }
    const origin = row[ORIGIN_COLUMN];
    if (origin === "original") {
      const response = originals.get(responseId);
      if (!response)
        throw backendFailure("INTERNAL", "Synthetic result references an unknown source row");
      return { responseId, submittedAtMs, origin: "original" as const, response };
    }
    if (origin === "synthetic") {
      return {
        responseId,
        submittedAtMs,
        origin: "synthetic" as const,
        response: syntheticResponse(form, plan, row, responseId, submittedAtMs),
      };
    }
    throw backendFailure("INTERNAL", "Synthetic result contains invalid provenance");
  });
};
