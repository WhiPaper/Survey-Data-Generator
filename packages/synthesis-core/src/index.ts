import type {
  AnswerSlot,
  ConditionPredicate,
  FormSnapshot,
  NormalizedResponse,
  ProjectTargets,
  QuestionId,
  QuestionTarget,
  TargetValue,
} from "@survey-synth/domain";
import { resolveResponsePath } from "@survey-synth/domain";
import {
  evaluateAdvancedFeature,
  mutateBranchAnswer,
  preservationDiagnostics,
  type AdvancedFeature,
  type PreservationDiagnostics,
} from "./advanced.js";

export * from "./advanced.js";

export type ConstraintPriority =
  | "form_hard"
  | "user_exact"
  | "user_approx"
  | "user_range"
  | "preserve_marginal"
  | "preserve_relationship"
  | "preserve_temporal"
  | "diversity";

export interface CanonicalMetric {
  readonly kind: "option_count" | "option_ratio" | "mean" | "selection_count_mean";
  readonly questionId: QuestionId;
  readonly optionKey?: string;
  readonly condition?: ConditionPredicate;
}

export interface CompiledConstraint {
  readonly metric: CanonicalMetric;
  readonly target: TargetValue;
  readonly priority: ConstraintPriority;
  /** Exact final numerator selected for a ratio target, if denominator is fixed. */
  readonly representableValue?: number;
}

export interface CompiledTargetSet {
  readonly targetResponseCount: number;
  readonly syntheticResponseCount: number;
  readonly aggregateConstraints: readonly CompiledConstraint[];
  readonly rowConstraints: readonly [];
  readonly preservationRequests: readonly CanonicalMetric[];
}

export type TargetLocation =
  | { type: "target-size" }
  | { type: "question-option"; questionId: QuestionId; optionKey: string }
  | { type: "question-mean"; questionId: QuestionId }
  | { type: "detailed-goal"; goalId: string };

export interface FeasibilityIssue {
  readonly location: TargetLocation;
  readonly code:
    | "TARGET_BELOW_SOURCE"
    | "ORIGINAL_CONTRIBUTION_EXCEEDS_TARGET"
    | "INVALID_TARGET"
    | "UNSUPPORTED_TARGET"
    | "MIP_INFEASIBLE"
    | "PROTECTED_NAVIGATION"
    | "STRUCTURAL_INFEASIBLE";
  readonly message: string;
  readonly suggestion?: "set_exact" | "set_range" | "remove";
}

export interface FeasibilityReport {
  readonly status: "feasible" | "infeasible" | "unknown";
  readonly strategy: "resampling_only" | "mutation_required" | null;
  readonly issues: readonly FeasibilityIssue[];
  readonly bounds: readonly [];
}

export interface LinearVariable {
  readonly id: string;
  readonly lowerBound: number;
  readonly upperBound?: number;
  readonly integer: boolean;
}

export interface LinearConstraint {
  readonly id: string;
  readonly coefficients: Readonly<Record<string, number>>;
  readonly relation: "=" | "<=" | ">=";
  readonly rightHandSide: number;
}

/** Narrow, solver-independent M4 optimization IR. */
export interface OptimizationProblem {
  readonly variables: readonly LinearVariable[];
  readonly constraints: readonly LinearConstraint[];
  readonly objective?: {
    readonly sense: "minimize";
    readonly coefficients: Readonly<Record<string, number>>;
  };
}

export interface OptimizationSolution {
  readonly status: "optimal" | "infeasible" | "unbounded" | "cancelled" | "error";
  readonly values: Readonly<Record<string, number>>;
}

export interface CancellationSignal {
  readonly aborted: boolean;
}

export interface OptimizationBackend {
  solveLinear(
    problem: OptimizationProblem,
    signal?: CancellationSignal,
  ): Promise<OptimizationSolution>;
  solveMixedInteger(
    problem: OptimizationProblem,
    signal?: CancellationSignal,
  ): Promise<OptimizationSolution>;
}

const slotFor = (response: NormalizedResponse, questionId: QuestionId): AnswerSlot =>
  response.answers[questionId] ?? { state: "indeterminate" };

export const answerNumber = (slot: AnswerSlot): number | undefined => {
  if (slot.state !== "answered") return undefined;
  if (slot.value.kind === "ordinal") return slot.value.value;
  if (slot.value.kind === "text") {
    const value = Number(slot.value.value.trim());
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
};

export const nearestRepresentable = (value: number, denominator: number): number => {
  if (!Number.isInteger(denominator) || denominator < 0) throw new Error("Invalid denominator");
  return Math.min(denominator, Math.max(0, Math.round(value * denominator)));
};

export const conditionMatches = (
  response: NormalizedResponse,
  condition: ConditionPredicate,
): boolean => {
  switch (condition.kind) {
    case "answered":
      return slotFor(response, condition.questionId).state === "answered";
    case "option_selected": {
      const answer = slotFor(response, condition.questionId);
      return (
        answer.state === "answered" &&
        ((answer.value.kind === "single_choice" &&
          answer.value.optionKey === condition.optionKey) ||
          (answer.value.kind === "multi_choice" &&
            answer.value.optionKeys.includes(condition.optionKey)))
      );
    }
    case "and":
      return condition.conditions.every((item) => conditionMatches(response, item));
    case "or":
      return condition.conditions.some((item) => conditionMatches(response, item));
  }
};

export const metricValue = (
  responses: readonly NormalizedResponse[],
  metric: CanonicalMetric,
): number | null => {
  const scoped =
    metric.condition === undefined
      ? responses
      : responses.filter((response) => conditionMatches(response, metric.condition!));
  if (metric.kind === "option_count" || metric.kind === "option_ratio") {
    const answered = scoped.filter(
      (response) => slotFor(response, metric.questionId).state === "answered",
    );
    const count = answered.filter((response) => {
      const slot = slotFor(response, metric.questionId);
      return (
        slot.state === "answered" &&
        ((slot.value.kind === "single_choice" && slot.value.optionKey === metric.optionKey) ||
          (slot.value.kind === "multi_choice" &&
            slot.value.optionKeys.includes(metric.optionKey as never)))
      );
    }).length;
    return metric.kind === "option_count"
      ? count
      : answered.length === 0
        ? 0
        : count / answered.length;
  }
  const values = scoped
    .map((response) => slotFor(response, metric.questionId))
    .map((answer) =>
      metric.kind === "selection_count_mean" &&
      answer.state === "answered" &&
      answer.value.kind === "multi_choice"
        ? answer.value.optionKeys.length
        : answerNumber(answer),
    )
    .filter((value): value is number => value !== undefined);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const metricFor = (
  target: QuestionTarget,
  condition?: ConditionPredicate,
): CanonicalMetric =>
  target.kind === "option"
    ? {
        kind:
          target.target.kind === "ratio" || target.target.kind === "ratio_range"
            ? "option_ratio"
            : "option_count",
        questionId: target.questionId,
        optionKey: target.optionKey,
        ...(condition === undefined ? {} : { condition }),
      }
    : {
        kind: target.kind === "selection_count_mean" ? "selection_count_mean" : "mean",
        questionId: target.questionId,
        ...(condition === undefined ? {} : { condition }),
      };

export interface CanonicalMetricAggregate {
  readonly numerator: number;
  readonly denominator: number;
}

/** Canonical linear contribution used by compiler, repair, and validator. */
export const canonicalMetricContribution = (
  response: NormalizedResponse,
  metric: CanonicalMetric,
): CanonicalMetricAggregate => {
  if (metric.condition !== undefined && !conditionMatches(response, metric.condition))
    return { numerator: 0, denominator: 0 };
  const answer = slotFor(response, metric.questionId);
  if (metric.kind === "option_count" || metric.kind === "option_ratio") {
    const answered = answer.state === "answered";
    const selected =
      answered &&
      ((answer.value.kind === "single_choice" && answer.value.optionKey === metric.optionKey) ||
        (answer.value.kind === "multi_choice" &&
          answer.value.optionKeys.includes(metric.optionKey as never)));
    return {
      numerator: Number(selected),
      denominator: metric.kind === "option_ratio" ? Number(answered) : 1,
    };
  }
  const value =
    metric.kind === "selection_count_mean" &&
    answer.state === "answered" &&
    answer.value.kind === "multi_choice"
      ? answer.value.optionKeys.length
      : answerNumber(answer);
  return value === undefined
    ? { numerator: 0, denominator: 0 }
    : { numerator: value, denominator: 1 };
};

export const canonicalMetricAggregate = (
  responses: readonly NormalizedResponse[],
  metric: CanonicalMetric,
): CanonicalMetricAggregate =>
  responses.reduce<CanonicalMetricAggregate>(
    (total, response) => {
      const contribution = canonicalMetricContribution(response, metric);
      return {
        numerator: total.numerator + contribution.numerator,
        denominator: total.denominator + contribution.denominator,
      };
    },
    { numerator: 0, denominator: 0 },
  );

const priorityFor = (target: TargetValue): ConstraintPriority =>
  target.kind === "ratio" || target.kind === "mean"
    ? "user_approx"
    : target.kind.endsWith("range")
      ? "user_range"
      : "user_exact";

const invalidTargetMessage = (target: TargetValue): string | null => {
  switch (target.kind) {
    case "count":
      return Number.isInteger(target.value) && target.value >= 0
        ? null
        : "Count must be a non-negative integer";
    case "ratio":
      return Number.isFinite(target.value) && target.value >= 0 && target.value <= 1
        ? null
        : "Ratio must be between zero and one";
    case "count_range":
      return Number.isInteger(target.min) &&
        Number.isInteger(target.max) &&
        target.min >= 0 &&
        target.min <= target.max
        ? null
        : "Count range must contain non-negative integer bounds";
    case "ratio_range":
      return Number.isFinite(target.min) &&
        Number.isFinite(target.max) &&
        target.min >= 0 &&
        target.max <= 1 &&
        target.min <= target.max
        ? null
        : "Ratio range must be ordered and remain between zero and one";
    case "mean":
      return Number.isFinite(target.value) ? null : "Mean must be finite";
  }
};

export const compileTargets = (
  form: FormSnapshot,
  source: readonly NormalizedResponse[],
  targets: ProjectTargets,
): CompiledTargetSet => {
  const targetQuestionIds = new Set(targets.questionTargets.map((target) => target.questionId));
  const aggregateConstraints = targets.questionTargets.map((target) => {
    const metric = metricFor(target);
    const representableValue =
      target.target.kind === "ratio" &&
      source.every((response) => slotFor(response, target.questionId).state === "answered")
        ? nearestRepresentable(target.target.value, targets.targetResponseCount) /
          targets.targetResponseCount
        : undefined;
    return {
      metric,
      target: target.target,
      priority: priorityFor(target.target),
      representableValue,
    };
  });
  const conditionalConstraints = (targets.detailedGoals ?? []).map((goal) => ({
    metric: metricFor(goal.outcome, goal.condition),
    target: goal.outcome.target,
    priority: priorityFor(goal.outcome.target),
  }));
  const preservationRequests: CanonicalMetric[] = form.questions
    .filter((question) => !targetQuestionIds.has(question.id))
    .flatMap<CanonicalMetric>((question) =>
      question.kind === "single_choice"
        ? question.options.map((option) => ({
            kind: "option_ratio" as const,
            questionId: question.id,
            optionKey: option.key,
          }))
        : question.kind === "ordinal" || question.kind === "text"
          ? [{ kind: "mean" as const, questionId: question.id }]
          : [],
    );
  return {
    targetResponseCount: targets.targetResponseCount,
    syntheticResponseCount: targets.targetResponseCount - source.length,
    aggregateConstraints: [...aggregateConstraints, ...conditionalConstraints],
    rowConstraints: [],
    preservationRequests,
  };
};

export const checkFeasibility = (
  form: FormSnapshot,
  source: readonly NormalizedResponse[],
  targets: ProjectTargets,
): FeasibilityReport => {
  const issues: FeasibilityIssue[] = [];
  if (!Number.isInteger(targets.targetResponseCount) || targets.targetResponseCount < source.length)
    issues.push({
      location: { type: "target-size" },
      code: "TARGET_BELOW_SOURCE",
      message: "Final response count cannot be below immutable source count",
      suggestion: "set_exact",
    });
  for (const target of targets.questionTargets) {
    const question = form.questions.find((entry) => entry.id === target.questionId);
    if (question === undefined) {
      issues.push({
        location:
          target.kind === "option"
            ? {
                type: "question-option",
                questionId: target.questionId,
                optionKey: target.optionKey,
              }
            : { type: "question-mean", questionId: target.questionId },
        code: "UNSUPPORTED_TARGET",
        message: "Question is not in this source revision",
        suggestion: "remove",
      });
      continue;
    }
    if (
      target.kind === "option" &&
      question.kind !== "single_choice" &&
      question.kind !== "multi_choice"
    ) {
      issues.push({
        location: {
          type: "question-option",
          questionId: target.questionId,
          optionKey: target.optionKey,
        },
        code: "UNSUPPORTED_TARGET",
        message: "Option target requires a single-choice or checkbox question",
        suggestion: "remove",
      });
      continue;
    }
    if (
      target.kind === "option" &&
      (question.kind === "single_choice" || question.kind === "multi_choice") &&
      !question.options.some((option) => option.key === target.optionKey)
    ) {
      issues.push({
        location: {
          type: "question-option",
          questionId: target.questionId,
          optionKey: target.optionKey,
        },
        code: "UNSUPPORTED_TARGET",
        message: "Option is not in this source revision",
        suggestion: "remove",
      });
      continue;
    }
    const invalid = invalidTargetMessage(target.target);
    if (invalid !== null) {
      issues.push({
        location:
          target.kind === "option"
            ? {
                type: "question-option",
                questionId: target.questionId,
                optionKey: target.optionKey,
              }
            : { type: "question-mean", questionId: target.questionId },
        code: "INVALID_TARGET",
        message: invalid,
        suggestion: "remove",
      });
      continue;
    }
    if (target.kind === "selection_count_mean" && question.kind !== "multi_choice") {
      issues.push({
        location: { type: "question-mean", questionId: target.questionId },
        code: "UNSUPPORTED_TARGET",
        message: "Selection-count mean requires a checkbox question",
        suggestion: "remove",
      });
      continue;
    }
    if (
      target.kind === "selection_count_mean" &&
      question.kind === "multi_choice" &&
      (target.target.value < 0 || target.target.value > question.options.length)
    ) {
      issues.push({
        location: { type: "question-mean", questionId: target.questionId },
        code: "INVALID_TARGET",
        message: "Selection-count mean is outside checkbox bounds",
        suggestion: "remove",
      });
      continue;
    }
    if (target.kind === "mean" && !(question.kind === "ordinal" || question.kind === "text")) {
      issues.push({
        location: { type: "question-mean", questionId: target.questionId },
        code: "UNSUPPORTED_TARGET",
        message: "Mean target requires ordinal or numeric semantic text",
        suggestion: "remove",
      });
      continue;
    }
    if (target.kind === "mean" && question.kind === "text") {
      const numeric = source.every((response) => {
        const slot = slotFor(response, question.id);
        return slot.state !== "answered" || answerNumber(slot) !== undefined;
      });
      if (!numeric)
        issues.push({
          location: { type: "question-mean", questionId: target.questionId },
          code: "UNSUPPORTED_TARGET",
          message: "Text question is not numeric semantic text",
          suggestion: "remove",
        });
    }
    if (
      target.kind === "mean" &&
      question.kind === "ordinal" &&
      (target.target.value < question.min || target.target.value > question.max)
    ) {
      issues.push({
        location: { type: "question-mean", questionId: target.questionId },
        code: "INVALID_TARGET",
        message: "Ordinal mean is outside the question score domain",
        suggestion: "remove",
      });
      continue;
    }
    const original =
      target.kind === "option"
        ? metricValue(source, {
            kind: "option_count",
            questionId: target.questionId,
            optionKey: target.optionKey,
          })
        : null;
    const requested =
      target.target.kind === "count"
        ? target.target.value
        : target.target.kind === "ratio" &&
            source.every((response) => slotFor(response, target.questionId).state === "answered")
          ? nearestRepresentable(target.target.value, targets.targetResponseCount)
          : target.target.kind === "count_range"
            ? target.target.max
            : target.target.kind === "ratio_range" &&
                source.every(
                  (response) => slotFor(response, target.questionId).state === "answered",
                )
              ? Math.floor(target.target.max * targets.targetResponseCount)
              : undefined;
    if (requested !== undefined && original !== null && original > requested)
      issues.push({
        location:
          target.kind === "option"
            ? {
                type: "question-option",
                questionId: target.questionId,
                optionKey: target.optionKey,
              }
            : { type: "question-mean", questionId: target.questionId },
        code: "ORIGINAL_CONTRIBUTION_EXCEEDS_TARGET",
        message: "Immutable original contribution already exceeds final exact target",
        suggestion: "set_exact",
      });
    if (
      target.kind === "option" &&
      question.kind === "single_choice" &&
      question.affectsNavigation &&
      requested !== undefined &&
      original !== null &&
      requested > original &&
      !source.some((row, index) => {
        if (optionSelectedForMetric(row, target.questionId, target.optionKey)) return true;
        return mutateBranchAnswer(
          form,
          source,
          { ...row, origin: "synthetic" },
          target.questionId,
          target.optionKey,
          index + 1,
        ).allowed;
      })
    )
      issues.push({
        location: {
          type: "question-option",
          questionId: target.questionId,
          optionKey: target.optionKey,
        },
        code: "STRUCTURAL_INFEASIBLE",
        message: "No safe donor supports the required branch structure",
        suggestion: "remove",
      });
  }
  for (const goal of targets.detailedGoals ?? []) {
    const referenced = conditionQuestionIds(goal.condition);
    const nested = checkFeasibility(form, source, {
      targetResponseCount: targets.targetResponseCount,
      questionTargets: [goal.outcome],
    });
    if (
      referenced.some(
        (questionId) => !form.questions.some((question) => question.id === questionId),
      )
    )
      issues.push({
        location: { type: "detailed-goal", goalId: goal.id },
        code: "UNSUPPORTED_TARGET",
        message: "Detailed goal condition references a missing question",
        suggestion: "remove",
      });
    if (referenced.includes(goal.outcome.questionId))
      issues.push({
        location: { type: "detailed-goal", goalId: goal.id },
        code: "UNSUPPORTED_TARGET",
        message: "Detailed goal outcome cannot redefine its own population",
        suggestion: "remove",
      });
    issues.push(
      ...nested.issues.map((issue) => ({
        ...issue,
        location: { type: "detailed-goal" as const, goalId: goal.id },
      })),
    );
  }
  return {
    status: issues.length
      ? issues.some((issue) => issue.code !== "UNSUPPORTED_TARGET")
        ? "infeasible"
        : "unknown"
      : "feasible",
    strategy: issues.length ? null : "mutation_required",
    issues,
    bounds: [],
  };
};

const optionSelectedForMetric = (
  row: NormalizedResponse,
  questionId: QuestionId,
  optionKey: string,
): boolean => {
  const answer = slotFor(row, questionId);
  return (
    answer.state === "answered" &&
    ((answer.value.kind === "single_choice" && answer.value.optionKey === optionKey) ||
      (answer.value.kind === "multi_choice" &&
        answer.value.optionKeys.includes(optionKey as never)))
  );
};

export interface ValidationMetric {
  readonly metric: CanonicalMetric;
  readonly requested: TargetValue;
  readonly actual: number | null;
  readonly satisfied: boolean;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly originalMutationCount: number;
  readonly finalResponseCount: number;
  readonly metrics: readonly ValidationMetric[];
  readonly errors: readonly string[];
  readonly preservation?: PreservationDiagnostics;
}

const targetSatisfied = (
  actual: number | null,
  target: TargetValue,
  denominator: number,
): boolean => {
  if (actual === null) return false;
  switch (target.kind) {
    case "count":
      return actual === target.value;
    case "ratio":
      return actual === nearestRepresentable(target.value, denominator) / denominator;
    case "count_range":
      return actual >= target.min && actual <= target.max;
    case "ratio_range":
      return actual >= target.min && actual <= target.max;
    case "mean":
      return true; // Mean representability depends on value support and is checked by compiler result below.
  }
};

export const validateSynthesis = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: readonly NormalizedResponse[],
  targets: ProjectTargets,
  advancedFeatures: readonly AdvancedFeature[] = [],
): ValidationResult => {
  const finalRows = [...original, ...synthetic];
  const originalMutationCount = original.filter((row) => row.origin !== "original").length;
  const validationTargets = [
    ...targets.questionTargets.map((target) => ({ target, condition: undefined })),
    ...(targets.detailedGoals ?? []).map((goal) => ({
      target: goal.outcome,
      condition: goal.condition,
    })),
  ];
  const metrics = validationTargets.map(({ target, condition }): ValidationMetric => {
    const metric = metricFor(target, condition);
    const actual = metricValue(finalRows, metric);
    const scopedRows =
      condition === undefined
        ? finalRows
        : finalRows.filter((row) => conditionMatches(row, condition));
    const denominator =
      metric.kind === "option_ratio"
        ? scopedRows.filter((row) => slotFor(row, metric.questionId).state === "answered").length
        : 1;
    const question = form.questions.find((entry) => entry.id === target.questionId);
    const answeredCount = scopedRows.filter((row) => {
      const answer = slotFor(row, target.questionId);
      return target.kind === "selection_count_mean"
        ? answer.state === "answered" && answer.value.kind === "multi_choice"
        : answerNumber(answer) !== undefined;
    }).length;
    const satisfied =
      target.target.kind === "mean"
        ? actual !== null &&
          answeredCount > 0 &&
          Math.abs(
            actual -
              (question?.kind === "ordinal" || target.kind === "selection_count_mean"
                ? Math.round(target.target.value * answeredCount) / answeredCount
                : target.target.value),
          ) <= 1e-9
        : targetSatisfied(actual, target.target, denominator);
    return { metric, requested: target.target, actual, satisfied };
  });
  const errors: string[] = [];
  if (finalRows.length !== targets.targetResponseCount)
    errors.push("FINAL_RESPONSE_COUNT_MISMATCH");
  if (originalMutationCount !== 0) errors.push("ORIGINAL_ROWS_MUTATED");
  if (synthetic.some((row) => row.origin !== "synthetic")) errors.push("SYNTHETIC_ORIGIN_INVALID");
  for (const row of synthetic) {
    for (const question of form.questions) {
      const slot = slotFor(row, question.id);
      if (
        slot.state === "answered" &&
        question.kind === "single_choice" &&
        slot.value.kind === "single_choice"
      ) {
        const optionKey = slot.value.optionKey;
        if (!question.options.some((option) => option.key === optionKey))
          errors.push("INVALID_OPTION_VALUE");
      }
      if (
        slot.state === "answered" &&
        question.kind === "ordinal" &&
        slot.value.kind === "ordinal" &&
        (slot.value.value < question.min ||
          slot.value.value > question.max ||
          !Number.isInteger(slot.value.value))
      )
        errors.push("INVALID_ORDINAL_VALUE");
      if (slot.state === "answered" && question.kind === "multi_choice") {
        if (
          slot.value.kind !== "multi_choice" ||
          new Set(slot.value.optionKeys).size !== slot.value.optionKeys.length ||
          slot.value.optionKeys.some(
            (key) => !question.options.some((option) => option.key === key),
          )
        )
          errors.push("INVALID_CHECKBOX_VALUE");
      }
    }
    const resolved = resolveResponsePath(form, row.answers);
    for (const question of form.questions) {
      const answer = slotFor(row, question.id);
      if (answer.state === "answered" && resolved.questions[question.id] === "not_reached")
        errors.push("BRANCH_CONTRADICTION");
      if (
        question.required &&
        resolved.questions[question.id] === "reached" &&
        answer.state !== "answered"
      )
        errors.push("REQUIRED_QUESTION_VIOLATION");
    }
  }
  for (const row of original) {
    for (const question of form.questions) {
      if (!question.required || row.path.questions[question.id] !== "reached") continue;
      if (slotFor(row, question.id).state !== "answered")
        errors.push("REQUIRED_QUESTION_VIOLATION");
    }
  }
  if (metrics.some((metric) => !metric.satisfied)) errors.push("HARD_TARGET_VIOLATION");
  return {
    valid: errors.length === 0,
    originalMutationCount,
    finalResponseCount: finalRows.length,
    metrics,
    errors,
    ...(advancedFeatures.length === 0
      ? {}
      : { preservation: preservationDiagnostics(original, finalRows, advancedFeatures) }),
  };
};

class SeededRandom {
  private state: number;
  public constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneSynthetic = (source: NormalizedResponse, index: number): NormalizedResponse => ({
  responseId: `synthetic-${index}` as NormalizedResponse["responseId"],
  createdAt: source.createdAt,
  lastSubmittedAt: source.lastSubmittedAt,
  answers: deepClone(source.answers),
  path: deepClone(source.path),
  origin: "synthetic",
});

const replaceSlot = (
  row: NormalizedResponse,
  questionId: QuestionId,
  slot: AnswerSlot,
): NormalizedResponse => ({
  ...row,
  answers: { ...row.answers, [questionId]: slot },
});

const repairOptionTarget = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: NormalizedResponse[],
  target: Extract<QuestionTarget, { kind: "option" }>,
  seed = 1,
): string | null => {
  const question = form.questions.find((entry) => entry.id === target.questionId);
  if (
    question === undefined ||
    (question.kind !== "single_choice" && question.kind !== "multi_choice") ||
    (question.kind === "multi_choice" && question.affectsNavigation)
  )
    return "UNSUPPORTED_OPTION_REPAIR";
  const answered = [...original, ...synthetic].filter(
    (row) => slotFor(row, target.questionId).state === "answered",
  );
  let actual =
    metricValue([...original, ...synthetic], {
      kind: "option_count",
      questionId: target.questionId,
      optionKey: target.optionKey,
    }) ?? 0;
  const desired =
    target.target.kind === "count"
      ? target.target.value
      : target.target.kind === "ratio"
        ? nearestRepresentable(target.target.value, answered.length)
        : target.target.kind === "count_range"
          ? Math.max(target.target.min, Math.min(target.target.max, actual))
          : target.target.kind === "ratio_range"
            ? (() => {
                const min = Math.ceil(target.target.min * answered.length);
                const max = Math.floor(target.target.max * answered.length);
                return min <= max ? Math.max(min, Math.min(max, actual)) : null;
              })()
            : null;
  if (desired === null) return "UNSUPPORTED_OPTION_TARGET";
  const alternatives = question.options.filter((option) => option.key !== target.optionKey);
  if (actual < desired) {
    for (let index = 0; index < synthetic.length && actual < desired; index += 1) {
      const answer = slotFor(synthetic[index]!, target.questionId);
      if (answer.state !== "answered") continue;
      const label = question.options.find((option) => option.key === target.optionKey)?.label ?? "";
      if (question.kind === "single_choice" && answer.value.kind === "single_choice") {
        if (answer.value.optionKey === target.optionKey) continue;
        if (question.affectsNavigation) {
          const mutation = mutateBranchAnswer(
            form,
            original,
            synthetic[index]!,
            target.questionId,
            target.optionKey,
            seed + index,
          );
          if (!mutation.allowed) continue;
          synthetic[index] = mutation.row;
        } else
          synthetic[index] = replaceSlot(synthetic[index]!, target.questionId, {
            state: "answered",
            value: { kind: "single_choice", optionKey: target.optionKey as never, label },
          });
      } else if (question.kind === "multi_choice" && answer.value.kind === "multi_choice") {
        if (answer.value.optionKeys.includes(target.optionKey)) continue;
        synthetic[index] = replaceSlot(synthetic[index]!, target.questionId, {
          state: "answered",
          value: {
            kind: "multi_choice",
            optionKeys: [...answer.value.optionKeys, target.optionKey as never],
            labels: [...answer.value.labels, label],
          },
        });
      } else continue;
      actual += 1;
    }
  } else if (actual > desired) {
    for (let index = 0; index < synthetic.length && actual > desired; index += 1) {
      const answer = slotFor(synthetic[index]!, target.questionId);
      if (answer.state !== "answered") continue;
      if (question.kind === "single_choice" && answer.value.kind === "single_choice") {
        if (answer.value.optionKey !== target.optionKey || alternatives.length === 0) continue;
        const replacement = alternatives[index % alternatives.length]!;
        if (question.affectsNavigation) {
          const mutation = mutateBranchAnswer(
            form,
            original,
            synthetic[index]!,
            target.questionId,
            replacement.key,
            seed + index,
          );
          if (!mutation.allowed) continue;
          synthetic[index] = mutation.row;
        } else
          synthetic[index] = replaceSlot(synthetic[index]!, target.questionId, {
            state: "answered",
            value: { kind: "single_choice", optionKey: replacement.key, label: replacement.label },
          });
      } else if (question.kind === "multi_choice" && answer.value.kind === "multi_choice") {
        if (!answer.value.optionKeys.includes(target.optionKey)) continue;
        const optionKeys = answer.value.optionKeys.filter((key) => key !== target.optionKey);
        synthetic[index] = replaceSlot(synthetic[index]!, target.questionId, {
          state: "answered",
          value: {
            kind: "multi_choice",
            optionKeys,
            labels: optionKeys.map(
              (key) => question.options.find((option) => option.key === key)?.label ?? "",
            ),
          },
        });
      } else continue;
      actual -= 1;
    }
  }
  return actual === desired ? null : "OPTION_TARGET_UNREACHABLE";
};

const repairSelectionCountMean = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: NormalizedResponse[],
  target: Extract<QuestionTarget, { kind: "selection_count_mean" }>,
): string | null => {
  const question = form.questions.find((entry) => entry.id === target.questionId);
  if (question?.kind !== "multi_choice") return "UNSUPPORTED_SELECTION_COUNT_REPAIR";
  const answered = [...original, ...synthetic].filter((row) => {
    const answer = slotFor(row, target.questionId);
    return answer.state === "answered" && answer.value.kind === "multi_choice";
  });
  if (answered.length === 0) return "SELECTION_COUNT_WITHOUT_ANSWERS";
  const desiredTotal = Math.round(target.target.value * answered.length);
  const originalTotal = original.reduce((sum, row) => {
    const answer = slotFor(row, target.questionId);
    return (
      sum +
      (answer.state === "answered" && answer.value.kind === "multi_choice"
        ? answer.value.optionKeys.length
        : 0)
    );
  }, 0);
  const candidates = synthetic
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const answer = slotFor(row, target.questionId);
      return answer.state === "answered" && answer.value.kind === "multi_choice";
    });
  let remaining = desiredTotal - originalTotal;
  for (let position = 0; position < candidates.length; position++) {
    const candidate = candidates[position]!;
    const later = candidates.length - position - 1;
    const count = Math.max(
      0,
      Math.min(question.options.length, Math.round(remaining / (later + 1))),
    );
    const answer = slotFor(candidate.row, target.questionId);
    if (answer.state !== "answered" || answer.value.kind !== "multi_choice") continue;
    const existing = answer.value.optionKeys.filter((key) =>
      question.options.some((option) => option.key === key),
    );
    const optionKeys = [
      ...existing,
      ...question.options.map((option) => option.key).filter((key) => !existing.includes(key)),
    ].slice(0, count);
    synthetic[candidate.index] = replaceSlot(candidate.row, target.questionId, {
      state: "answered",
      value: {
        kind: "multi_choice",
        optionKeys,
        labels: optionKeys.map(
          (key) => question.options.find((option) => option.key === key)?.label ?? "",
        ),
      },
    });
    remaining -= count;
  }
  return remaining === 0 ? null : "SELECTION_COUNT_TARGET_UNREACHABLE";
};

const conditionQuestionIds = (condition: ConditionPredicate): readonly QuestionId[] =>
  condition.kind === "answered" || condition.kind === "option_selected"
    ? [condition.questionId]
    : condition.conditions.flatMap(conditionQuestionIds);

const repairConditionalGoal = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: NormalizedResponse[],
  goal: NonNullable<ProjectTargets["detailedGoals"]>[number],
  seed: number,
): string | null => {
  if (conditionQuestionIds(goal.condition).includes(goal.outcome.questionId))
    return "CONDITIONAL_SCOPE_MUTATION_UNSUPPORTED";
  const originalPopulation = original.filter((row) => conditionMatches(row, goal.condition));
  const indexes = synthetic
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => conditionMatches(row, goal.condition))
    .map(({ index }) => index);
  const population = indexes.map((index) => synthetic[index]!);
  const error =
    goal.outcome.kind === "option"
      ? repairOptionTarget(form, originalPopulation, population, goal.outcome, seed)
      : repairMeanTarget(form, originalPopulation, population, goal.outcome);
  if (error !== null) return error;
  indexes.forEach((index, populationIndex) => {
    synthetic[index] = population[populationIndex]!;
  });
  return null;
};

const repairMeanTarget = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: NormalizedResponse[],
  target: Extract<QuestionTarget, { kind: "mean" }>,
): string | null => {
  const question = form.questions.find((entry) => entry.id === target.questionId);
  if (question === undefined || !(question.kind === "ordinal" || question.kind === "text"))
    return "UNSUPPORTED_MEAN_REPAIR";
  const rows = [...original, ...synthetic];
  const answeredCount = rows.filter(
    (row) => answerNumber(slotFor(row, target.questionId)) !== undefined,
  ).length;
  if (answeredCount === 0) return "MEAN_WITHOUT_ANSWERED_VALUES";
  const originalSum = original.reduce(
    (sum, row) => sum + (answerNumber(slotFor(row, target.questionId)) ?? 0),
    0,
  );
  const syntheticCandidates = synthetic
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => answerNumber(slotFor(row, target.questionId)) !== undefined);
  if (syntheticCandidates.length === 0) return "MEAN_TARGET_UNREACHABLE";
  const desiredSum =
    question.kind === "ordinal"
      ? Math.round(target.target.value * answeredCount)
      : target.target.value * answeredCount;
  let remaining = desiredSum - originalSum;
  const observed = rows
    .map((row) => answerNumber(slotFor(row, target.questionId)))
    .filter((value): value is number => value !== undefined);
  const min = question.kind === "ordinal" ? question.min : Math.min(...observed);
  const max = question.kind === "ordinal" ? question.max : Math.max(...observed);
  for (const { index } of syntheticCandidates) {
    const later = syntheticCandidates.filter((candidate) => candidate.index > index).length;
    const lower = Math.max(min, remaining - later * max);
    const upper = Math.min(max, remaining - later * min);
    if (lower > upper + 1e-9) return "MEAN_TARGET_UNREACHABLE";
    const value =
      question.kind === "ordinal"
        ? Math.round(Math.min(upper, Math.max(lower, remaining / (later + 1))))
        : Math.min(upper, Math.max(lower, remaining / (later + 1)));
    const slot: AnswerSlot =
      question.kind === "ordinal"
        ? { state: "answered", value: { kind: "ordinal", value } }
        : { state: "answered", value: { kind: "text", value: String(value) } };
    synthetic[index] = replaceSlot(synthetic[index]!, target.questionId, slot);
    remaining -= value;
  }
  return Math.abs(remaining) <= 1e-9 ? null : "MEAN_TARGET_UNREACHABLE";
};

export interface SynthesisResult {
  readonly kind: "success" | "infeasible";
  readonly synthetic: readonly NormalizedResponse[];
  readonly feasibility: FeasibilityReport;
  readonly validation?: ValidationResult;
}

export interface TemplateWeightPlan {
  readonly problem: OptimizationProblem;
  readonly templateResponseIds: readonly string[];
}

/** M4 feature compiler: each source template contributes explicit marginal features. */
export const compileTemplateWeights = (
  source: readonly NormalizedResponse[],
  compiledTargets: CompiledTargetSet,
  advancedFeatures: readonly AdvancedFeature[] = [],
): TemplateWeightPlan => {
  const syntheticCount = compiledTargets.syntheticResponseCount;
  const templateVariables = source.map((_, index) => ({
    id: `template_${index}`,
    lowerBound: 0,
    integer: true,
  }));
  const templateDeviationVariables = source.flatMap((_, index) => [
    { id: `deviation_up_${index}`, lowerBound: 0, integer: false },
    { id: `deviation_down_${index}`, lowerBound: 0, integer: false },
  ]);
  const featureDeviationVariables = advancedFeatures.flatMap((_, index) => [
    { id: `feature_up_${index}`, lowerBound: 0, integer: false },
    { id: `feature_down_${index}`, lowerBound: 0, integer: false },
  ]);
  const variables = [
    ...templateVariables,
    ...templateDeviationVariables,
    ...featureDeviationVariables,
  ];
  const constraints: LinearConstraint[] = [
    {
      id: "synthetic_count",
      coefficients: Object.fromEntries(templateVariables.map((variable) => [variable.id, 1])),
      relation: "=",
      rightHandSide: syntheticCount,
    },
  ];
  const expectedPerTemplate = source.length === 0 ? 0 : syntheticCount / source.length;
  for (let index = 0; index < source.length; index += 1) {
    constraints.push({
      id: `preserve_template_${index}`,
      coefficients: {
        [`template_${index}`]: 1,
        [`deviation_up_${index}`]: -1,
        [`deviation_down_${index}`]: 1,
      },
      relation: "=",
      rightHandSide: expectedPerTemplate,
    });
  }
  advancedFeatures.forEach((feature, featureIndex) => {
    constraints.push({
      id: `feature_${featureIndex}`,
      coefficients: {
        ...Object.fromEntries(
          templateVariables.map((variable, rowIndex) => {
            const value = evaluateAdvancedFeature(source[rowIndex]!, feature);
            return [variable.id, value === null ? 0 : value - feature.sourceValue];
          }),
        ),
        [`feature_up_${featureIndex}`]: -1,
        [`feature_down_${featureIndex}`]: 1,
      },
      relation: "=",
      rightHandSide: 0,
    });
  });
  for (const [constraintIndex, constraint] of compiledTargets.aggregateConstraints.entries()) {
    const { metric, target } = constraint;
    if (metric.kind !== "option_count" && metric.kind !== "option_ratio") continue;
    const original =
      metricValue(source, {
        kind: "option_count",
        questionId: metric.questionId,
        optionKey: metric.optionKey,
      }) ?? 0;
    const originalAnswered = source.filter(
      (row) =>
        (metric.condition === undefined || conditionMatches(row, metric.condition)) &&
        slotFor(row, metric.questionId).state === "answered",
    ).length;
    const coefficients = Object.fromEntries(
      templateVariables.map((variable, index) => {
        const slot = slotFor(source[index]!, metric.questionId);
        const contributes =
          (metric.condition === undefined || conditionMatches(source[index]!, metric.condition)) &&
          slot.state === "answered" &&
          ((slot.value.kind === "single_choice" && slot.value.optionKey === metric.optionKey) ||
            (slot.value.kind === "multi_choice" &&
              slot.value.optionKeys.includes(metric.optionKey as never)));
        return [variable.id, contributes ? 1 : 0];
      }),
    );
    const id = `target_${constraintIndex}`;
    if (target.kind === "count") {
      constraints.push({
        id,
        coefficients,
        relation: "=",
        rightHandSide: target.value - original,
      });
    } else if (target.kind === "ratio") {
      const ratioCoefficients = Object.fromEntries(
        templateVariables.map((variable, index) => {
          const slot = slotFor(source[index]!, metric.questionId);
          const numerator = coefficients[variable.id] ?? 0;
          const denominator =
            (metric.condition === undefined ||
              conditionMatches(source[index]!, metric.condition)) &&
            slot.state === "answered"
              ? 1
              : 0;
          return [variable.id, numerator - target.value * denominator];
        }),
      );
      constraints.push({
        id,
        coefficients: ratioCoefficients,
        relation: "=",
        rightHandSide: -(original - target.value * originalAnswered),
      });
    } else if (target.kind === "count_range") {
      constraints.push({
        id: `${id}_min`,
        coefficients,
        relation: ">=",
        rightHandSide: target.min - original,
      });
      constraints.push({
        id: `${id}_max`,
        coefficients,
        relation: "<=",
        rightHandSide: target.max - original,
      });
    } else if (target.kind === "ratio_range") {
      for (const [suffix, relation, ratio] of [
        ["min", ">=", target.min],
        ["max", "<=", target.max],
      ] as const) {
        const ratioCoefficients = Object.fromEntries(
          templateVariables.map((variable, index) => {
            const slot = slotFor(source[index]!, metric.questionId);
            const numerator = coefficients[variable.id] ?? 0;
            const denominator =
              (metric.condition === undefined ||
                conditionMatches(source[index]!, metric.condition)) &&
              slot.state === "answered"
                ? 1
                : 0;
            return [variable.id, numerator - ratio * denominator];
          }),
        );
        constraints.push({
          id: `${id}_${suffix}`,
          coefficients: ratioCoefficients,
          relation,
          rightHandSide: -(original - ratio * originalAnswered),
        });
      }
    }
  }
  return {
    problem: {
      variables,
      constraints,
      objective: {
        sense: "minimize",
        coefficients: {
          ...Object.fromEntries(templateDeviationVariables.map((variable) => [variable.id, 0.01])),
          ...Object.fromEntries(
            featureDeviationVariables.map((variable, index) => {
              const feature = advancedFeatures[Math.floor(index / 2)];
              return [variable.id, feature?.reliability ?? 0];
            }),
          ),
        },
      },
    },
    templateResponseIds: source.map((response) => String(response.responseId)),
  };
};

/** Converts exact integer template weights to deterministic synthetic template indexes. */
export const allocateTemplateWeights = (
  plan: TemplateWeightPlan,
  values: Readonly<Record<string, number>>,
): readonly number[] | null => {
  const allocated: number[] = [];
  for (let index = 0; index < plan.templateResponseIds.length; index += 1) {
    const value = values[`template_${index}`] ?? 0;
    if (!Number.isInteger(value) || value < 0) return null;
    for (let count = 0; count < value; count += 1) allocated.push(index);
  }
  return allocated;
};

/** M4 deterministic template allocation plus only safe value repair. */
export const synthesize = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  targets: ProjectTargets,
  seed: number,
  allocatedTemplateIndexes?: readonly number[],
  advancedFeatures: readonly AdvancedFeature[] = [],
): SynthesisResult => {
  const feasibility = checkFeasibility(form, original, targets);
  if (feasibility.status !== "feasible" || original.length === 0)
    return { kind: "infeasible", synthetic: [], feasibility };
  const random = new SeededRandom(seed);
  const expectedSyntheticCount = targets.targetResponseCount - original.length;
  if (
    allocatedTemplateIndexes !== undefined &&
    allocatedTemplateIndexes.length !== expectedSyntheticCount
  )
    return {
      kind: "infeasible",
      synthetic: [],
      feasibility: {
        ...feasibility,
        status: "infeasible",
        strategy: null,
        issues: [
          {
            location: { type: "target-size" },
            code: "INVALID_TARGET",
            message: "Integer allocation does not match synthetic response count",
          },
        ],
      },
    };
  const synthetic = Array.from(
    { length: targets.targetResponseCount - original.length },
    (_, index) =>
      cloneSynthetic(
        original[allocatedTemplateIndexes?.[index] ?? Math.floor(random.next() * original.length)]!,
        index,
      ),
  );
  const errors = targets.questionTargets
    .map((target) =>
      target.kind === "option"
        ? repairOptionTarget(form, original, synthetic, target, seed)
        : target.kind === "selection_count_mean"
          ? repairSelectionCountMean(form, original, synthetic, target)
          : repairMeanTarget(form, original, synthetic, target),
    )
    .filter((error): error is string => error !== null);
  errors.push(
    ...(targets.detailedGoals ?? [])
      .map((goal, index) => repairConditionalGoal(form, original, synthetic, goal, seed + index))
      .filter((error): error is string => error !== null),
  );
  if (errors.length)
    return {
      kind: "infeasible",
      synthetic: [],
      feasibility: {
        ...feasibility,
        status: "unknown",
        strategy: null,
        issues: [
          ...feasibility.issues,
          ...errors.map((message) => ({
            location: { type: "target-size" } as TargetLocation,
            code: "UNSUPPORTED_TARGET" as const,
            message,
          })),
        ],
      },
    };
  const validation = validateSynthesis(form, original, synthetic, targets, advancedFeatures);
  return validation.valid
    ? { kind: "success", synthetic, feasibility, validation }
    : {
        kind: "infeasible",
        synthetic: [],
        feasibility: {
          ...feasibility,
          status: "infeasible",
          strategy: null,
          issues: validation.errors.map((message) => ({
            location: { type: "target-size" } as TargetLocation,
            code: "INVALID_TARGET" as const,
            message,
          })),
        },
        validation,
      };
};
