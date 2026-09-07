import type {
  FrozenRunTarget,
  FrozenTargetSubject,
  RunTargetBaseline,
} from "@survey-synth/contracts";
import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  QuestionId,
} from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { StoredSourceResponse } from "../persistence/store";

const normalizedResponse = (value: unknown): NormalizedResponse => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw backendFailure("INTERNAL", "Stored normalized response is invalid");
  }
  return value as NormalizedResponse;
};

const answer = (stored: StoredSourceResponse, questionId: string): AnswerSlot | undefined =>
  normalizedResponse(stored.response).answers[questionId as QuestionId];

const eligible = (slot: AnswerSlot | undefined): boolean =>
  slot?.state === "answered" || slot?.state === "skipped";

const frozenSubjectMetric = (
  form: FormSnapshot,
  responses: readonly StoredSourceResponse[],
  subject: FrozenTargetSubject,
): { count: number; denominatorCount: number; share: number } | null => {
  if (subject.kind === "option") {
    const question = form.questions.find((candidate) => candidate.id === subject.questionId);
    if (!question || question.kind !== "single_choice") return null;
    if (!question.options.some((option) => String(option.key) === subject.optionKey)) return null;
    let count = 0;
    let denominatorCount = 0;
    for (const stored of responses) {
      const slot = answer(stored, question.id);
      if (!eligible(slot)) continue;
      denominatorCount += 1;
      if (
        slot?.state === "answered" &&
        slot.value.kind === "single_choice" &&
        String(slot.value.optionKey) === subject.optionKey
      ) {
        count += 1;
      }
    }
    return {
      count,
      denominatorCount,
      share: denominatorCount === 0 ? 0 : count / denominatorCount,
    };
  }

  if (subject.kind === "checkbox_option") {
    const question = form.questions.find((candidate) => candidate.id === subject.questionId);
    if (!question || question.kind !== "multi_choice") return null;
    if (!question.options.some((option) => String(option.key) === subject.optionKey)) return null;
    let count = 0;
    let denominatorCount = 0;
    for (const stored of responses) {
      const slot = answer(stored, question.id);
      if (!eligible(slot)) continue;
      denominatorCount += 1;
      if (
        slot?.state === "answered" &&
        slot.value.kind === "multi_choice" &&
        slot.value.optionKeys.some((key) => String(key) === subject.optionKey)
      ) {
        count += 1;
      }
    }
    return {
      count,
      denominatorCount,
      share: denominatorCount === 0 ? 0 : count / denominatorCount,
    };
  }

  const group = subject.valueGroup;
  const members = new Set(group.members);
  const question = form.questions.find((candidate) => candidate.id === group.questionId);
  if (!question || (question.kind !== "single_choice" && question.kind !== "text")) return null;
  let count = 0;
  let denominatorCount = 0;
  for (const stored of responses) {
    const slot = answer(stored, question.id);
    if (!eligible(slot)) continue;
    denominatorCount += 1;
    if (slot?.state !== "answered") continue;
    let value: string | null = null;
    if (question.kind === "single_choice" && slot.value.kind === "single_choice") {
      value = String(slot.value.optionKey);
    } else if (question.kind === "text" && slot.value.kind === "text") {
      value = slot.value.value;
    }
    if (value !== null && members.has(value)) count += 1;
  }
  return { count, denominatorCount, share: denominatorCount === 0 ? 0 : count / denominatorCount };
};

const meanBaseline = (
  form: FormSnapshot,
  responses: readonly StoredSourceResponse[],
  questionId: string,
): { mean: number; denominatorCount: number } | null => {
  const question = form.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.kind !== "ordinal") return null;
  const values: number[] = [];
  for (const stored of responses) {
    const slot = answer(stored, question.id);
    if (slot?.state === "answered" && slot.value.kind === "ordinal") values.push(slot.value.value);
  }
  return {
    mean: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
    denominatorCount: values.length,
  };
};

const conditionalBaseline = (
  form: FormSnapshot,
  responses: readonly StoredSourceResponse[],
  target: Extract<FrozenRunTarget, { kind: "conditional_share" }>,
): { count: number; denominatorCount: number; share: number } | null => {
  const group = target.population.valueGroup;
  const members = new Set(group.members);
  const populationQuestion = form.questions.find((candidate) => candidate.id === group.questionId);
  const checkboxQuestion = form.questions.find((candidate) => candidate.id === target.questionId);
  if (
    !populationQuestion ||
    (populationQuestion.kind !== "single_choice" && populationQuestion.kind !== "text") ||
    !checkboxQuestion ||
    checkboxQuestion.kind !== "multi_choice" ||
    !checkboxQuestion.options.some((option) => String(option.key) === target.optionKey)
  ) {
    return null;
  }

  let count = 0;
  let denominatorCount = 0;
  for (const stored of responses) {
    const response = normalizedResponse(stored.response);
    const population = response.answers[populationQuestion.id as QuestionId];
    let raw: string | null = null;
    if (population?.state === "answered") {
      if (
        populationQuestion.kind === "single_choice" &&
        population.value.kind === "single_choice"
      ) {
        raw = String(population.value.optionKey);
      } else if (populationQuestion.kind === "text" && population.value.kind === "text") {
        raw = population.value.value;
      }
    }
    if (raw === null || !members.has(raw)) continue;

    const checkbox = response.answers[checkboxQuestion.id as QuestionId];
    if (!eligible(checkbox)) continue;
    denominatorCount += 1;
    if (
      checkbox?.state === "answered" &&
      checkbox.value.kind === "multi_choice" &&
      checkbox.value.optionKeys.some((key) => String(key) === target.optionKey)
    ) {
      count += 1;
    }
  }
  return { count, denominatorCount, share: denominatorCount === 0 ? 0 : count / denominatorCount };
};

const invalidBaseline = (): never => {
  throw backendFailure("INTERNAL", "Historical Run target baseline cannot be reconstructed");
};

export const buildRunTargetBaselines = (
  form: FormSnapshot,
  responses: readonly StoredSourceResponse[],
  targets: readonly FrozenRunTarget[],
): RunTargetBaseline[] =>
  targets.map((target) => {
    if (target.kind === "mean") {
      const metric = meanBaseline(form, responses, target.questionId) ?? invalidBaseline();
      return {
        targetId: target.id,
        kind: "mean",
        mean: metric.mean,
        denominatorCount: metric.denominatorCount,
      };
    }

    if (target.kind === "conditional_share") {
      const metric = conditionalBaseline(form, responses, target) ?? invalidBaseline();
      return {
        targetId: target.id,
        kind: "conditional_share",
        count: metric.count,
        denominatorCount: metric.denominatorCount,
        share: metric.share,
      };
    }

    const metric = frozenSubjectMetric(form, responses, target.subject) ?? invalidBaseline();
    if (target.kind === "count") {
      return { targetId: target.id, kind: "count", count: metric.count };
    }
    return {
      targetId: target.id,
      kind: "share",
      count: metric.count,
      denominatorCount: metric.denominatorCount,
      share: metric.share,
    };
  });
