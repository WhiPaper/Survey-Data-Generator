import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { parquetWriteFile } from "hyparquet-writer";

import {
  resolveResponsePath,
  type AnswerSlot,
  type FormSnapshot,
  type NormalizedResponse,
  type QuestionId,
} from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { StoredSourceResponse } from "../persistence/store";

export const RESPONSE_ID_COLUMN = "response_id";
export const TIMESTAMP_COLUMN = "submitted_at";
export const TARGET_SCORE_COLUMN = "target_score";
const ORIGIN_COLUMN = "__origin";

export type FlatTablePlan = {
  targetQuestionId: QuestionId;
  questionColumns: ReadonlyMap<QuestionId, string>;
};

export type DecodedRunRow = {
  responseId: string;
  submittedAtMs: number;
  origin: "original" | "synthetic";
  response: NormalizedResponse;
};

type ParquetRecord = Record<string, unknown>;

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

const targetScore = (response: NormalizedResponse, questionId: QuestionId): number => {
  const slot = response.answers[questionId];
  if (slot?.state !== "answered" || slot.value.kind !== "ordinal") {
    throw backendFailure(
      "VALIDATION_FAILED",
      "M4/M5 mean synthesis currently requires the target ordinal question to be answered in every source row",
    );
  }
  return slot.value.value;
};

export const createFlatTablePlan = (
  form: FormSnapshot,
  targetQuestionId: QuestionId,
): FlatTablePlan => {
  const questionColumns = new Map<QuestionId, string>();
  let index = 0;
  for (const question of form.questions) {
    if (question.id === targetQuestionId) continue;
    questionColumns.set(question.id, `q_${index}`);
    index += 1;
  }
  return { targetQuestionId, questionColumns };
};

export const valueGroupMemberCells = (
  responses: readonly StoredSourceResponse[],
  questionId: QuestionId,
  members: readonly string[],
): string[] => {
  const memberSet = new Set(members);
  const cells = new Set<string>();
  for (const stored of responses) {
    const slot = asNormalizedResponse(stored.response).answers[questionId];
    if (
      slot?.state === "answered" &&
      slot.value.kind === "single_choice" &&
      memberSet.has(String(slot.value.optionKey))
    ) {
      cells.add(JSON.stringify(slot));
    }
  }
  return [...cells];
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
        name: TARGET_SCORE_COLUMN,
        data: normalized.map(({ response }) => targetScore(response, plan.targetQuestionId)),
        type: "DOUBLE" as const,
        nullable: false,
      },
      ...questionColumns,
    ],
  });

  void form;
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

const syntheticResponse = (
  form: FormSnapshot,
  plan: FlatTablePlan,
  row: ParquetRecord,
  responseId: string,
  submittedAtMs: number,
): NormalizedResponse => {
  const provisional = {} as Record<QuestionId, AnswerSlot>;
  const scoreValue = row[TARGET_SCORE_COLUMN];
  const score = typeof scoreValue === "number" ? scoreValue : Number(scoreValue);
  if (!Number.isFinite(score) || !Number.isInteger(score)) {
    throw backendFailure("INTERNAL", "Synthetic result contains an invalid ordinal score");
  }
  provisional[plan.targetQuestionId] = {
    state: "answered",
    value: { kind: "ordinal", value: score },
  };

  for (const [questionId, column] of plan.questionColumns) {
    provisional[questionId] = parseGeneratedSlot(row[column], questionId);
  }

  const path = resolveResponsePath(form, provisional);
  const answers = {} as Record<QuestionId, AnswerSlot>;
  for (const question of form.questions) {
    const slot = provisional[question.id];
    if (!slot) throw backendFailure("INTERNAL", `Synthetic result is missing question ${question.id}`);
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
    sourceResponses.map((stored) => [stored.responseId, asNormalizedResponse(stored.response)] as const),
  );
  const rows = (await parquetReadObjects({ file: await asyncBufferFromFile(path) })) as ParquetRecord[];
  return rows.map((row) => {
    const responseId = stringValue(row[RESPONSE_ID_COLUMN], "response_id");
    const submittedAtMs = timestampMs(row[TIMESTAMP_COLUMN]);
    if (!Number.isFinite(submittedAtMs)) {
      throw backendFailure("INTERNAL", "Synthetic result contains an invalid timestamp");
    }
    const origin = row[ORIGIN_COLUMN];
    if (origin === "original") {
      const response = originals.get(responseId);
      if (!response) throw backendFailure("INTERNAL", "Synthetic result references an unknown source row");
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
