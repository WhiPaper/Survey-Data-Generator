import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  ProfileBase,
  Question,
  QuestionId,
  TextClusterGroup,
} from "@survey-synth/domain";
import { clusterTextResponses } from "./text-cluster.js";

export type ShortTextSemanticType =
  | "numeric"
  | "categorical"
  | "identifier"
  | "personal_identifier"
  | "formatted_string"
  | "free_text"
  | "unknown";

export interface SemanticInference {
  readonly inferred: ShortTextSemanticType;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export interface SemanticOverride {
  readonly questionId: QuestionId;
  readonly value: ShortTextSemanticType;
  readonly updatedAt: string;
}

export interface QuestionProfile extends ProfileBase {
  readonly questionKind: Question["kind"];
  readonly semanticInference?: SemanticInference;
  readonly numeric?: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    p05: number;
    p25: number;
    p75: number;
    p95: number;
  };
  readonly choices?: Readonly<Record<string, { count: number; share: number }>>;
  readonly selectionCounts?: Readonly<Record<string, number>>;
  readonly lengths?: { min: number; max: number; mean: number; median: number };
  readonly temporal?: { count: number; distinctCount: number; min?: string; max?: string };
  readonly fileMetadata?: { answeredFiles: number; fileCount: number };
  readonly textClusters?: readonly TextClusterGroup[];
}

const slotFor = (response: NormalizedResponse, id: QuestionId): AnswerSlot =>
  response.answers[id] ?? { state: "indeterminate" };

export const profileBase = (
  questionId: QuestionId,
  responses: readonly NormalizedResponse[],
): ProfileBase => {
  let answeredCount = 0;
  let skippedCount = 0;
  let notReachedCount = 0;
  let indeterminateCount = 0;
  for (const response of responses) {
    switch (slotFor(response, questionId).state) {
      case "answered":
        answeredCount += 1;
        break;
      case "skipped":
        skippedCount += 1;
        break;
      case "not_reached":
        notReachedCount += 1;
        break;
      case "indeterminate":
        indeterminateCount += 1;
        break;
    }
  }
  const confirmedEligibleCount = answeredCount + skippedCount;
  return {
    questionId,
    answeredCount,
    skippedCount,
    notReachedCount,
    indeterminateCount,
    confirmedEligibleCount,
    responseRate: confirmedEligibleCount === 0 ? 0 : answeredCount / confirmedEligibleCount,
  };
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1] ?? 0;
  const upper = sorted[middle] ?? lower;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
};

const quantile = (values: readonly number[], probability: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return (
    (sorted[lower] ?? 0) + ((sorted[upper] ?? sorted[lower] ?? 0) - (sorted[lower] ?? 0)) * fraction
  );
};

const asText = (slot: AnswerSlot): string | undefined =>
  slot.state === "answered" && slot.value.kind === "text" ? slot.value.value : undefined;

export const inferShortTextSemantic = (
  question: Extract<Question, { kind: "text" }>,
  responses: readonly NormalizedResponse[],
): SemanticInference => {
  const values = responses
    .map((r) => asText(slotFor(r, question.id)))
    .filter((v): v is string => v !== undefined);
  if (values.length === 0) return { inferred: "unknown", confidence: 0, evidence: ["no_samples"] };
  const unique = new Set(values);
  const numericValues = values
    .map((v) => v.trim())
    .filter((v) => v !== "" && Number.isFinite(Number(v)));
  const parseable = numericValues.length / values.length;
  const uniqueRate = unique.size / values.length;
  const lengths = values.map((v) => v.length);
  const leadingZero = values.some((v) => /^0\d+$/.test(v));
  const sequenceLike = values.every((v, i) => i === 0 || Number(v) === Number(values[i - 1]) + 1);
  const emailLike =
    values.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)).length / values.length;
  const title = `${question.title} ${question.description ?? ""}`.toLowerCase();
  const piiHint = /(email|e-mail|phone|telephone|전화|이메일|연락처|주소|address|name|이름)/.test(
    title,
  );
  const evidence: string[] = [];
  if (emailLike >= 0.8) evidence.push("email_shape");
  if (leadingZero) evidence.push("leading_zero");
  if (sequenceLike && values.length > 2) evidence.push("sequence_like");
  if (parseable >= 0.9) evidence.push("high_numeric_parse_ratio");
  if (uniqueRate >= 0.95) evidence.push("high_uniqueness");
  if (values.some((v) => /\s/.test(v) || v.length > 80)) evidence.push("long_or_multiline");
  if (piiHint) evidence.push("title_context_hint");
  let inferred: ShortTextSemanticType = "unknown";
  let score = 0.25;
  if (emailLike >= 0.8 || (piiHint && emailLike >= 0.4)) {
    inferred = "personal_identifier";
    score = 0.9;
  } else if (leadingZero || (uniqueRate >= 0.9 && parseable >= 0.8) || sequenceLike) {
    inferred = "identifier";
    score = 0.86;
  } else if (parseable >= 0.9 && uniqueRate < 0.9) {
    inferred = "numeric";
    score = 0.82;
  } else if (uniqueRate <= 0.45 && unique.size <= Math.max(8, values.length / 3)) {
    inferred = "categorical";
    score = 0.75;
  } else if (uniqueRate >= 0.8 && (values.some((v) => /\s/.test(v)) || median(lengths) > 40)) {
    inferred = "free_text";
    score = 0.78;
  } else if (uniqueRate >= 0.8 && values.every((v) => /^[A-Za-z0-9_-]+$/.test(v))) {
    inferred = "formatted_string";
    score = 0.65;
  }
  return { inferred, confidence: values.length < 5 ? score * 0.65 : score, evidence };
};

export const profileQuestion = (
  question: Question,
  responses: readonly NormalizedResponse[],
): QuestionProfile => {
  const base = profileBase(question.id, responses);
  const profile: QuestionProfile = { ...base, questionKind: question.kind };
  if (question.kind === "single_choice") {
    const counts: Record<string, number> = {};
    for (const option of question.options) counts[option.key] = 0;
    for (const response of responses) {
      const slot = slotFor(response, question.id);
      if (slot.state === "answered" && slot.value.kind === "single_choice")
        counts[slot.value.optionKey] = (counts[slot.value.optionKey] ?? 0) + 1;
    }
    return {
      ...profile,
      choices: Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [
          key,
          { count, share: base.answeredCount ? count / base.answeredCount : 0 },
        ]),
      ),
    };
  }
  if (question.kind === "multi_choice") {
    const counts: Record<string, number> = {};
    for (const option of question.options) counts[option.key] = 0;
    const distribution: Record<string, number> = {};
    for (const response of responses) {
      const slot = slotFor(response, question.id);
      if (slot.state === "answered" && slot.value.kind === "multi_choice") {
        distribution[slot.value.optionKeys.length] =
          (distribution[slot.value.optionKeys.length] ?? 0) + 1;
        for (const key of slot.value.optionKeys) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return {
      ...profile,
      choices: Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [
          key,
          { count, share: base.answeredCount ? count / base.answeredCount : 0 },
        ]),
      ),
      selectionCounts: distribution,
    };
  }
  if (question.kind === "ordinal") {
    const values = responses
      .map((r) => slotFor(r, question.id))
      .flatMap((s) =>
        s.state === "answered" && s.value.kind === "ordinal" ? [s.value.value] : [],
      );
    return {
      ...profile,
      numeric: {
        count: values.length,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
        mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
        median: median(values),
        p05: quantile(values, 0.05),
        p25: quantile(values, 0.25),
        p75: quantile(values, 0.75),
        p95: quantile(values, 0.95),
      },
    };
  }
  if (question.kind === "text") {
    const values = responses
      .map((r) => asText(slotFor(r, question.id)))
      .filter((v): v is string => v !== undefined);
    const numbers = values
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map(Number)
      .filter(Number.isFinite);
    const inference = inferShortTextSemantic(question, responses);
    const textClusters =
      inference.inferred !== "numeric" && values.length > 0
        ? clusterTextResponses(values)
        : undefined;
    return {
      ...profile,
      semanticInference: inference,
      ...(textClusters && textClusters.length > 0 ? { textClusters } : {}),
      ...(inference.inferred === "numeric" && numbers.length
        ? {
            numeric: {
              count: numbers.length,
              min: Math.min(...numbers),
              max: Math.max(...numbers),
              mean: numbers.reduce((a, b) => a + b, 0) / numbers.length,
              median: median(numbers),
              p05: quantile(numbers, 0.05),
              p25: quantile(numbers, 0.25),
              p75: quantile(numbers, 0.75),
              p95: quantile(numbers, 0.95),
            },
          }
        : {}),
      ...(values.length
        ? {
            lengths: {
              min: Math.min(...values.map((v) => v.length)),
              max: Math.max(...values.map((v) => v.length)),
              mean: values.reduce((a, v) => a + v.length, 0) / values.length,
              median: median(values.map((v) => v.length)),
            },
          }
        : {}),
    };
  }
  if (question.kind === "date" || question.kind === "time") {
    const values = responses
      .map((r) => slotFor(r, question.id))
      .flatMap((slot) =>
        slot.state === "answered" && (slot.value.kind === "date" || slot.value.kind === "time")
          ? [slot.value.value]
          : [],
      );
    return {
      ...profile,
      temporal: {
        count: values.length,
        distinctCount: new Set(values).size,
        ...(values.length ? { min: [...values].sort()[0], max: [...values].sort().at(-1) } : {}),
      },
    };
  }
  if (question.kind === "file") {
    const fileCounts = responses
      .map((r) => slotFor(r, question.id))
      .flatMap((slot) =>
        slot.state === "answered" && slot.value.kind === "file" ? [slot.value.files.length] : [],
      );
    return {
      ...profile,
      fileMetadata: {
        answeredFiles: fileCounts.filter((count) => count > 0).length,
        fileCount: fileCounts.reduce((sum, count) => sum + count, 0),
      },
    };
  }
  return profile;
};

export const profileForm = (
  form: FormSnapshot,
  responses: readonly NormalizedResponse[],
): QuestionProfile[] => form.questions.map((question) => profileQuestion(question, responses));
