import {
  resolveResponsePath,
  type AnswerSlot,
  type ConditionPredicate,
  type FormSnapshot,
  type NormalizedResponse,
  type OptionKey,
  type ProjectTargets,
  type Question,
  type QuestionId,
} from "@survey-synth/domain";
import type { RelationshipProfile } from "@survey-synth/statistics";
import {
  answerNumber,
  canonicalMetricAggregate,
  canonicalMetricContribution,
  compileTargets,
  nearestRepresentable,
  type CancellationSignal,
  type CompiledConstraint,
  type ConstraintPriority,
  type LinearConstraint,
  type OptimizationBackend,
  type OptimizationProblem,
  type OptimizationSolution,
} from "./index.js";

export const ADVANCED_LIMITS = Object.freeze({
  relationships: 40,
  jointCellsPerRelationship: 8,
  checkboxOptions: 20,
  checkboxPairsPerQuestion: 12,
  selectionCountBins: 8,
  donorTopK: 5,
  mutationCandidates: 400,
});

export type AdvancedFeatureKind =
  | "checkbox_option"
  | "checkbox_selection_count"
  | "checkbox_cooccurrence"
  | "categorical_joint"
  | "numeric_interaction"
  | "categorical_numeric_group"
  | "answer_state"
  | "temporal_bucket"
  | "temporal_joint";

export interface AdvancedFeature {
  readonly id: string;
  readonly kind: AdvancedFeatureKind;
  readonly questionA: QuestionId;
  readonly questionB?: QuestionId;
  readonly optionA?: OptionKey;
  readonly optionB?: OptionKey;
  readonly selectionCount?: number;
  readonly state?: AnswerSlot["state"];
  readonly bucketA?: string;
  readonly bucketB?: string;
  readonly centerA?: number;
  readonly scaleA?: number;
  readonly centerB?: number;
  readonly scaleB?: number;
  readonly sourceValue: number;
  readonly reliability: number;
  readonly priority: "preserve_marginal" | "preserve_relationship" | "preserve_temporal";
}

const slot = (row: NormalizedResponse, id: QuestionId): AnswerSlot =>
  row.answers[id] ?? { state: "indeterminate" };

const numericValue = (answer: AnswerSlot): number | null => {
  if (answer.state !== "answered") return null;
  if (answer.value.kind === "ordinal") return answer.value.value;
  if (answer.value.kind === "text") {
    const parsed = Number(answer.value.value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (answer.value.kind === "date") {
    const parsed = Date.parse(answer.value.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (answer.value.kind === "time") {
    const parts = answer.value.value.split(":").map(Number);
    return parts.every(Number.isFinite)
      ? (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
      : null;
  }
  return null;
};

const categoricalValue = (answer: AnswerSlot): string | null => {
  if (answer.state !== "answered") return null;
  return answer.value.kind === "single_choice" ? String(answer.value.optionKey) : null;
};

const temporalTokens = (answer: AnswerSlot): readonly string[] => {
  if (answer.state !== "answered") return [];
  if (answer.value.kind === "date") {
    const date = new Date(`${answer.value.value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? []
      : [`weekday_${date.getUTCDay()}`, `month_${date.getUTCMonth() + 1}`];
  }
  if (answer.value.kind === "time") {
    const hour = Number(answer.value.value.split(":")[0]);
    return Number.isInteger(hour) && hour >= 0 && hour < 24
      ? [`hour4_${Math.floor(hour / 4)}`]
      : [];
  }
  return [];
};

const relationshipTokens = (answer: AnswerSlot): readonly string[] => {
  const temporal = temporalTokens(answer);
  if (temporal.length > 0) return temporal;
  const categorical = categoricalValue(answer);
  if (categorical !== null) return [`category_${categorical}`];
  const numeric = numericValue(answer);
  return numeric === null ? [] : [`numeric_${numeric}`];
};

export const evaluateAdvancedFeature = (
  row: NormalizedResponse,
  feature: Omit<AdvancedFeature, "sourceValue">,
): number | null => {
  const left = slot(row, feature.questionA);
  switch (feature.kind) {
    case "checkbox_option":
      return left.state === "answered" && left.value.kind === "multi_choice"
        ? Number(left.value.optionKeys.includes(feature.optionA!))
        : null;
    case "checkbox_selection_count":
      return left.state === "answered" && left.value.kind === "multi_choice"
        ? Number(left.value.optionKeys.length === feature.selectionCount)
        : null;
    case "checkbox_cooccurrence":
      return left.state === "answered" && left.value.kind === "multi_choice"
        ? Number(
            left.value.optionKeys.includes(feature.optionA!) &&
              left.value.optionKeys.includes(feature.optionB!),
          )
        : null;
    case "categorical_joint": {
      const right = slot(row, feature.questionB!);
      const a = categoricalValue(left);
      const b = categoricalValue(right);
      return a === null || b === null
        ? null
        : Number(a === feature.optionA && b === feature.optionB);
    }
    case "numeric_interaction": {
      const a = numericValue(left);
      const b = numericValue(slot(row, feature.questionB!));
      if (a === null || b === null) return null;
      return (
        ((a - (feature.centerA ?? 0)) / (feature.scaleA || 1)) *
        ((b - (feature.centerB ?? 0)) / (feature.scaleB || 1))
      );
    }
    case "categorical_numeric_group": {
      const category = categoricalValue(left);
      const value = numericValue(slot(row, feature.questionB!));
      if (category === null || value === null) return null;
      return category === feature.optionA
        ? (value - (feature.centerB ?? 0)) / (feature.scaleB || 1)
        : 0;
    }
    case "answer_state":
      return Number(left.state === feature.state);
    case "temporal_bucket":
      return left.state === "answered"
        ? Number(temporalTokens(left).includes(feature.bucketA!))
        : null;
    case "temporal_joint": {
      const right = slot(row, feature.questionB!);
      const a = relationshipTokens(left);
      const b = relationshipTokens(right);
      return a.length === 0 || b.length === 0
        ? null
        : Number(a.includes(feature.bucketA!) && b.includes(feature.bucketB!));
    }
  }
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const spread = (values: readonly number[], center: number): number =>
  Math.sqrt(mean(values.map((value) => (value - center) ** 2))) || 1;

const finalize = (
  rows: readonly NormalizedResponse[],
  feature: Omit<AdvancedFeature, "sourceValue">,
): AdvancedFeature => {
  const values = rows
    .map((row) => evaluateAdvancedFeature(row, feature))
    .filter((value): value is number => value !== null);
  return { ...feature, sourceValue: mean(values) };
};

export const compileAdvancedFeatures = (
  form: FormSnapshot,
  rows: readonly NormalizedResponse[],
  relationships: readonly RelationshipProfile[],
): readonly AdvancedFeature[] => {
  const features: AdvancedFeature[] = [];
  const add = (feature: Omit<AdvancedFeature, "sourceValue">): void => {
    if (!features.some((existing) => existing.id === feature.id))
      features.push(finalize(rows, feature));
  };
  for (const question of form.questions) {
    for (const state of ["answered", "skipped", "not_reached", "indeterminate"] as const)
      add({
        id: `state:${question.id}:${state}`,
        kind: "answer_state",
        questionA: question.id,
        state,
        reliability:
          1 -
          rows.filter((row) => slot(row, question.id).state === "indeterminate").length /
            Math.max(1, rows.length),
        priority: "preserve_marginal",
      });
    if (question.kind === "date" || question.kind === "time") {
      const buckets = [
        ...new Set(rows.flatMap((row) => temporalTokens(slot(row, question.id)))),
      ].sort();
      for (const bucket of buckets)
        add({
          id: `temporal:${question.id}:${bucket}`,
          kind: "temporal_bucket",
          questionA: question.id,
          bucketA: bucket,
          reliability: 1,
          priority: "preserve_temporal",
        });
    }
    if (question.kind !== "multi_choice") continue;
    for (const option of question.options.slice(0, ADVANCED_LIMITS.checkboxOptions))
      add({
        id: `checkbox:${question.id}:option:${option.key}`,
        kind: "checkbox_option",
        questionA: question.id,
        optionA: option.key,
        reliability: 1,
        priority: "preserve_marginal",
      });
    const counts = rows
      .map((row) => slot(row, question.id))
      .filter(
        (answer): answer is Extract<AnswerSlot, { state: "answered" }> =>
          answer.state === "answered" && answer.value.kind === "multi_choice",
      )
      .map((answer) => (answer.value.kind === "multi_choice" ? answer.value.optionKeys.length : 0));
    for (const count of [...new Set(counts)]
      .sort((a, b) => a - b)
      .slice(0, ADVANCED_LIMITS.selectionCountBins))
      add({
        id: `checkbox:${question.id}:count:${count}`,
        kind: "checkbox_selection_count",
        questionA: question.id,
        selectionCount: count,
        reliability: 1,
        priority: "preserve_marginal",
      });
  }

  const selected = relationships
    .filter((relationship) => relationship.preserveRecommended)
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, ADVANCED_LIMITS.relationships);
  const questionById = new Map(form.questions.map((question) => [question.id, question]));
  const pairCounts = new Map<string, number>();
  for (const relationship of selected) {
    const qa = questionById.get(relationship.questionA);
    const qb = questionById.get(relationship.questionB);
    if (qa === undefined || qb === undefined) continue;
    const relationshipPriority =
      qa.kind === "date" || qa.kind === "time" || qb.kind === "date" || qb.kind === "time"
        ? "preserve_temporal"
        : "preserve_relationship";
    if (relationshipPriority === "preserve_temporal") {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const leftTokens = relationshipTokens(slot(row, qa.id));
        const rightTokens = relationshipTokens(slot(row, qb.id));
        for (const a of leftTokens)
          for (const b of rightTokens)
            counts.set(`${a}\u0000${b}`, (counts.get(`${a}\u0000${b}`) ?? 0) + 1);
      }
      for (const [pair] of [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, ADVANCED_LIMITS.jointCellsPerRelationship)) {
        const [bucketA, bucketB] = pair.split("\u0000");
        add({
          id: `temporal-joint:${qa.id}:${bucketA}:${qb.id}:${bucketB}`,
          kind: "temporal_joint",
          questionA: qa.id,
          questionB: qb.id,
          bucketA,
          bucketB,
          reliability: relationship.reliability,
          priority: "preserve_temporal",
        });
      }
      continue;
    }
    if (relationship.family === "checkbox_option_option") {
      const used = pairCounts.get(String(qa.id)) ?? 0;
      if (used >= ADVANCED_LIMITS.checkboxPairsPerQuestion) continue;
      const encoded = relationship.preservationFeatures.find((item) =>
        item.startsWith("cooccurrence:"),
      );
      const [, optionA, optionB] = encoded?.split(":") ?? [];
      if (optionA === undefined || optionB === undefined) continue;
      add({
        id: `checkbox:${qa.id}:pair:${optionA}:${optionB}`,
        kind: "checkbox_cooccurrence",
        questionA: qa.id,
        optionA: optionA as OptionKey,
        optionB: optionB as OptionKey,
        reliability: relationship.reliability,
        priority: relationshipPriority,
      });
      pairCounts.set(String(qa.id), used + 1);
      continue;
    }
    if (relationship.family === "categorical_categorical") {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const a = categoricalValue(slot(row, qa.id));
        const b = categoricalValue(slot(row, qb.id));
        if (a !== null && b !== null)
          counts.set(`${a}\u0000${b}`, (counts.get(`${a}\u0000${b}`) ?? 0) + 1);
      }
      for (const [cell] of [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, ADVANCED_LIMITS.jointCellsPerRelationship)) {
        const [optionA, optionB] = cell.split("\u0000");
        add({
          id: `joint:${qa.id}:${optionA}:${qb.id}:${optionB}`,
          kind: "categorical_joint",
          questionA: qa.id,
          questionB: qb.id,
          optionA: optionA as OptionKey,
          optionB: optionB as OptionKey,
          reliability: relationship.reliability,
          priority: relationshipPriority,
        });
      }
      continue;
    }
    if (
      relationship.family === "categorical_numeric" ||
      relationship.family === "categorical_ordinal" ||
      relationship.family === "ordinal_categorical"
    ) {
      const categorical =
        qa.kind === "single_choice" ? qa : qb.kind === "single_choice" ? qb : null;
      const numeric = categorical?.id === qa.id ? qb : qa;
      if (categorical !== null) {
        const numericValues = rows
          .map((row) => numericValue(slot(row, numeric.id)))
          .filter((value): value is number => value !== null);
        const center = mean(numericValues);
        const scale = spread(numericValues, center);
        const groups = categorical.options
          .map((option) => ({
            option,
            count: rows.filter((row) => categoricalValue(slot(row, categorical.id)) === option.key)
              .length,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, ADVANCED_LIMITS.jointCellsPerRelationship);
        for (const { option } of groups)
          add({
            id: `group:${categorical.id}:${option.key}:${numeric.id}`,
            kind: "categorical_numeric_group",
            questionA: categorical.id,
            questionB: numeric.id,
            optionA: option.key,
            centerB: center,
            scaleB: scale,
            reliability: relationship.reliability,
            priority: relationshipPriority,
          });
      }
      continue;
    }
    const aValues = rows
      .map((row) => numericValue(slot(row, qa.id)))
      .filter((v): v is number => v !== null);
    const bValues = rows
      .map((row) => numericValue(slot(row, qb.id)))
      .filter((v): v is number => v !== null);
    if (aValues.length > 0 && bValues.length > 0) {
      const centerA = mean(aValues);
      const centerB = mean(bValues);
      add({
        id: `interaction:${qa.id}:${qb.id}`,
        kind: "numeric_interaction",
        questionA: qa.id,
        questionB: qb.id,
        centerA,
        scaleA: spread(aValues, centerA),
        centerB,
        scaleB: spread(bValues, centerB),
        reliability: relationship.reliability,
        priority: relationshipPriority,
      });
    }
  }
  return features;
};

export class FeatureAccumulator {
  private readonly sums: number[];
  private readonly counts: number[];
  public constructor(
    private readonly features: readonly AdvancedFeature[],
    rows: readonly NormalizedResponse[],
  ) {
    this.sums = features.map(() => 0);
    this.counts = features.map(() => 0);
    for (const row of rows) this.add(row, 1);
  }
  private add(row: NormalizedResponse, direction: 1 | -1): void {
    this.features.forEach((feature, index) => {
      const value = evaluateAdvancedFeature(row, feature);
      if (value === null) return;
      this.sums[index] = (this.sums[index] ?? 0) + direction * value;
      this.counts[index] = (this.counts[index] ?? 0) + direction;
    });
  }
  public replace(before: NormalizedResponse, after: NormalizedResponse): void {
    this.add(before, -1);
    this.add(after, 1);
  }
  public values(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      this.features.map((feature, index) => [
        feature.id,
        (this.counts[index] ?? 0) === 0 ? 0 : (this.sums[index] ?? 0) / this.counts[index]!,
      ]),
    );
  }
  public aggregates(): Readonly<Record<string, { readonly sum: number; readonly count: number }>> {
    return Object.fromEntries(
      this.features.map((feature, index) => [
        feature.id,
        { sum: this.sums[index] ?? 0, count: this.counts[index] ?? 0 },
      ]),
    );
  }
}

class Random {
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

const safeDonorValue = (question: Question, answer: AnswerSlot): AnswerSlot | null => {
  if (answer.state !== "answered") return null;
  if (
    question.kind === "text" ||
    question.kind === "file" ||
    question.kind === "date" ||
    question.kind === "time" ||
    question.kind === "unsupported"
  )
    return null;
  return JSON.parse(JSON.stringify(answer)) as AnswerSlot;
};

const distance = (
  form: FormSnapshot,
  left: NormalizedResponse,
  right: NormalizedResponse,
  branchQuestionId: QuestionId,
): number => {
  const branchQuestion = form.questions.find((question) => question.id === branchQuestionId);
  const branchSection = form.logic.sections.find(
    (section) => section.id === branchQuestion?.sectionId,
  );
  let total = 0;
  let compared = 0;
  for (const question of form.questions) {
    const section = form.logic.sections.find((item) => item.id === question.sectionId);
    if (branchSection !== undefined && section !== undefined && section.order > branchSection.order)
      continue;
    if (question.id === branchQuestionId) continue;
    const a = slot(left, question.id);
    const b = slot(right, question.id);
    if (a.state !== "answered" || b.state !== "answered") continue;
    compared++;
    if (a.value.kind === "single_choice" && b.value.kind === "single_choice")
      total += Number(a.value.optionKey !== b.value.optionKey);
    else if (a.value.kind === "multi_choice" && b.value.kind === "multi_choice") {
      const union = new Set([...a.value.optionKeys, ...b.value.optionKeys]);
      const rightKeys = b.value.optionKeys;
      const intersection = a.value.optionKeys.filter((value) => rightKeys.includes(value));
      total += union.size === 0 ? 0 : 1 - intersection.length / union.size;
    } else {
      const av = numericValue(a);
      const bv = numericValue(b);
      if (av !== null && bv !== null)
        total += Math.abs(av - bv) / (1 + Math.abs(av) + Math.abs(bv));
    }
  }
  return compared === 0 ? 1 : total / compared;
};

export type StructuralMutationResult =
  | { readonly allowed: true; readonly row: NormalizedResponse }
  | {
      readonly allowed: false;
      readonly reason:
        "logic_ambiguous" | "restart_flow" | "no_donor_support" | "unsupported_navigation";
    };

export const mutateBranchAnswer = (
  form: FormSnapshot,
  sourceRows: readonly NormalizedResponse[],
  row: NormalizedResponse,
  questionId: QuestionId,
  optionKey: OptionKey,
  seed: number,
): StructuralMutationResult => {
  if (row.path.confidence === "ambiguous") return { allowed: false, reason: "logic_ambiguous" };
  const question = form.questions.find((item) => item.id === questionId);
  if (question?.kind !== "single_choice" || !question.affectsNavigation)
    return { allowed: false, reason: "unsupported_navigation" };
  const option = question.options.find((item) => item.key === optionKey);
  const transition = form.logic.transitions.find(
    (item) => item.sourceQuestionId === questionId && item.optionKey === optionKey,
  );
  if (option === undefined || transition === undefined)
    return { allowed: false, reason: "unsupported_navigation" };
  if (transition.destination.type === "restart") return { allowed: false, reason: "restart_flow" };

  const answers: Record<QuestionId, AnswerSlot> = {
    ...row.answers,
    [questionId]: {
      state: "answered" as const,
      value: { kind: "single_choice" as const, optionKey, label: option.label },
    },
  };
  let path = resolveResponsePath(form, answers);
  if (path.confidence === "ambiguous") return { allowed: false, reason: "logic_ambiguous" };
  const newlyReached = form.questions.filter(
    (item) => row.path.questions[item.id] !== "reached" && path.questions[item.id] === "reached",
  );
  for (const item of form.questions)
    if (path.questions[item.id] === "not_reached") answers[item.id] = { state: "not_reached" };

  const required = newlyReached.filter((item) => item.required);
  const donors = sourceRows
    .filter((candidate) => candidate.path.confidence !== "ambiguous")
    .filter((candidate) =>
      required.every((item) => candidate.path.questions[item.id] === "reached"),
    )
    .filter((candidate) =>
      required.every((item) => safeDonorValue(item, slot(candidate, item.id)) !== null),
    )
    .map((candidate) => ({ candidate, distance: distance(form, row, candidate, questionId) }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        String(a.candidate.responseId).localeCompare(String(b.candidate.responseId)),
    )
    .slice(0, ADVANCED_LIMITS.donorTopK);
  if (required.length > 0 && donors.length === 0)
    return { allowed: false, reason: "no_donor_support" };
  const random = new Random(seed);
  const weights = donors.map((donor) => 1 / Math.max(0.001, donor.distance + 0.05));
  let cursor = random.next() * weights.reduce((sum, value) => sum + value, 0);
  const donor =
    donors.find((_, index) => (cursor -= weights[index] ?? 0) <= 0)?.candidate ??
    donors[0]?.candidate;
  for (const item of newlyReached) {
    const donorValue = donor === undefined ? null : safeDonorValue(item, slot(donor, item.id));
    answers[item.id] = donorValue ?? { state: item.required ? "indeterminate" : "skipped" };
  }
  path = resolveResponsePath(form, answers);
  if (required.some((item) => slot({ ...row, answers }, item.id).state !== "answered"))
    return { allowed: false, reason: "no_donor_support" };
  return {
    allowed: true,
    row: { ...row, answers, path },
  };
};

export interface RepairCandidate {
  readonly id: string;
  readonly rowIndex: number;
  readonly questionId: QuestionId;
  readonly row: NormalizedResponse;
  readonly cost: number;
  readonly structural: boolean;
  readonly metricDeltas: readonly {
    readonly numerator: number;
    readonly denominator: number;
  }[];
  readonly featureDeltas: Readonly<
    Record<string, { readonly sum: number; readonly count: number }>
  >;
  readonly diversityDelta: number;
}

const replaceAnswer = (
  row: NormalizedResponse,
  questionId: QuestionId,
  answer: AnswerSlot,
): NormalizedResponse => ({ ...row, answers: { ...row.answers, [questionId]: answer } });

const candidateForOption = (
  form: FormSnapshot,
  source: readonly NormalizedResponse[],
  row: NormalizedResponse,
  rowIndex: number,
  questionId: QuestionId,
  optionKey: OptionKey,
  seed: number,
): Omit<RepairCandidate, "metricDeltas" | "featureDeltas" | "diversityDelta"> | null => {
  const question = form.questions.find((item) => item.id === questionId);
  const answer = slot(row, questionId);
  if (
    question === undefined ||
    (question.kind !== "single_choice" && question.kind !== "multi_choice") ||
    answer.state !== "answered"
  )
    return null;
  if (question.kind === "single_choice") {
    if (question.affectsNavigation) {
      const mutation = mutateBranchAnswer(form, source, row, questionId, optionKey, seed);
      return mutation.allowed
        ? {
            id: `repair_${rowIndex}_${String(questionId).replace(/[^A-Za-z0-9_]/g, "_")}_${String(optionKey).replace(/[^A-Za-z0-9_]/g, "_")}`,
            rowIndex,
            questionId,
            row: mutation.row,
            cost: 10,
            structural: true,
          }
        : null;
    }
    const option = question.options.find((item) => item.key === optionKey);
    if (
      option === undefined ||
      answer.value.kind !== "single_choice" ||
      answer.value.optionKey === optionKey
    )
      return null;
    return {
      id: `repair_${rowIndex}_${String(questionId).replace(/[^A-Za-z0-9_]/g, "_")}_${String(optionKey).replace(/[^A-Za-z0-9_]/g, "_")}`,
      rowIndex,
      questionId,
      row: replaceAnswer(row, questionId, {
        state: "answered",
        value: { kind: "single_choice", optionKey, label: option.label },
      }),
      cost: 1,
      structural: false,
    };
  }
  if (answer.value.kind !== "multi_choice") return null;
  const option = question.options.find((item) => item.key === optionKey);
  if (option === undefined) return null;
  const has = answer.value.optionKeys.includes(optionKey);
  const optionKeys = has
    ? answer.value.optionKeys.filter((key) => key !== optionKey)
    : [...answer.value.optionKeys, optionKey];
  return {
    id: `repair_${rowIndex}_${String(questionId).replace(/[^A-Za-z0-9_]/g, "_")}_${has ? "remove" : "add"}_${String(optionKey).replace(/[^A-Za-z0-9_]/g, "_")}`,
    rowIndex,
    questionId,
    row: replaceAnswer(row, questionId, {
      state: "answered",
      value: {
        kind: "multi_choice",
        optionKeys,
        labels: optionKeys.map(
          (key) => question.options.find((item) => item.key === key)?.label ?? "",
        ),
      },
    }),
    cost: 1 + Math.abs(optionKeys.length - answer.value.optionKeys.length),
    structural: false,
  };
};

export interface GlobalRepairPlan {
  readonly problem: OptimizationProblem;
  readonly candidates: readonly RepairCandidate[];
  readonly objectiveStages: readonly {
    readonly priority: ConstraintPriority | "mutation_cost" | "stable_tie";
    readonly coefficients: Readonly<Record<string, number>>;
  }[];
  readonly diagnostics: {
    readonly featureCount: number;
    readonly candidateCount: number;
    readonly generatedCandidateCount: number;
    readonly prunedCandidateCount: number;
    readonly constraintCount: number;
  };
}

const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");

const conditionQuestionIds = (condition: ConditionPredicate): readonly QuestionId[] =>
  condition.kind === "answered" || condition.kind === "option_selected"
    ? [condition.questionId]
    : condition.conditions.flatMap(conditionQuestionIds);

const replaceValueCandidate = (
  row: NormalizedResponse,
  rowIndex: number,
  questionId: QuestionId,
  answer: AnswerSlot,
  suffix: string,
): Omit<RepairCandidate, "metricDeltas" | "featureDeltas" | "diversityDelta"> | null => {
  if (JSON.stringify(slot(row, questionId)) === JSON.stringify(answer)) return null;
  return {
    id: `repair_${rowIndex}_${sanitize(String(questionId))}_${sanitize(suffix)}`,
    rowIndex,
    questionId,
    row: replaceAnswer(row, questionId, answer),
    cost: 1,
    structural: false,
  };
};

const hardError = (
  aggregate: { readonly numerator: number; readonly denominator: number },
  constraint: CompiledConstraint,
): number => {
  const { target } = constraint;
  if (target.kind === "count") return Math.abs(aggregate.numerator - target.value);
  if (target.kind === "count_range")
    return Math.max(target.min - aggregate.numerator, aggregate.numerator - target.max, 0);
  if (target.kind === "ratio") {
    if (aggregate.denominator <= 0) return Number.POSITIVE_INFINITY;
    return Math.abs(
      aggregate.numerator - nearestRepresentable(target.value, aggregate.denominator),
    );
  }
  if (target.kind === "ratio_range") {
    if (aggregate.denominator <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(
      target.min * aggregate.denominator - aggregate.numerator,
      aggregate.numerator - target.max * aggregate.denominator,
      0,
    );
  }
  if (aggregate.denominator <= 0) return Number.POSITIVE_INFINITY;
  const desired =
    constraint.metric.kind === "selection_count_mean"
      ? Math.round(target.value * aggregate.denominator)
      : target.value * aggregate.denominator;
  return Math.abs(aggregate.numerator - desired);
};

const addExactDynamicAggregate = (
  variables: OptimizationProblem["variables"] extends readonly (infer V)[] ? V[] : never,
  constraints: LinearConstraint[],
  candidates: readonly RepairCandidate[],
  metricIndex: number,
  base: { readonly numerator: number; readonly denominator: number },
  desiredNumerator: (denominator: number) => number,
  maxDenominator: number,
): void => {
  const selectors = Array.from({ length: maxDenominator }, (_, index) => {
    const denominator = index + 1;
    const id = `target_${metricIndex}_den_${denominator}`;
    variables.push({ id, lowerBound: 0, upperBound: 1, integer: true });
    return { id, denominator };
  });
  constraints.push({
    id: `target_${metricIndex}_den_one`,
    coefficients: Object.fromEntries(selectors.map((selector) => [selector.id, 1])),
    relation: "=",
    rightHandSide: 1,
  });
  constraints.push({
    id: `target_${metricIndex}_den_link`,
    coefficients: {
      ...Object.fromEntries(
        candidates.map((candidate) => [
          candidate.id,
          candidate.metricDeltas[metricIndex]?.denominator ?? 0,
        ]),
      ),
      ...Object.fromEntries(selectors.map((selector) => [selector.id, -selector.denominator])),
    },
    relation: "=",
    rightHandSide: -base.denominator,
  });
  constraints.push({
    id: `target_${metricIndex}_nearest`,
    coefficients: {
      ...Object.fromEntries(
        candidates.map((candidate) => [
          candidate.id,
          candidate.metricDeltas[metricIndex]?.numerator ?? 0,
        ]),
      ),
      ...Object.fromEntries(
        selectors.map((selector) => [selector.id, -desiredNumerator(selector.denominator)]),
      ),
    },
    relation: "=",
    rightHandSide: -base.numerator,
  });
};

const addFeatureDeviation = (
  variables: OptimizationProblem["variables"] extends readonly (infer V)[] ? V[] : never,
  constraints: LinearConstraint[],
  candidates: readonly RepairCandidate[],
  feature: AdvancedFeature,
  featureIndex: number,
  base: { readonly sum: number; readonly count: number },
  maxCount: number,
): string => {
  const deviationId = `feature_dev_${featureIndex}`;
  variables.push({ id: deviationId, lowerBound: 0, integer: false });
  const countMutable = candidates.some(
    (candidate) => (candidate.featureDeltas[feature.id]?.count ?? 0) !== 0,
  );
  if (!countMutable) {
    const deltas = Object.fromEntries(
      candidates.map((candidate) => [candidate.id, candidate.featureDeltas[feature.id]?.sum ?? 0]),
    );
    if (base.count === 0)
      constraints.push({
        id: `feature_${featureIndex}_fixed_zero`,
        coefficients: { [deviationId]: 1 },
        relation: ">=",
        rightHandSide: Math.abs(feature.sourceValue),
      });
    else {
      constraints.push({
        id: `feature_${featureIndex}_fixed_up`,
        coefficients: { ...deltas, [deviationId]: -base.count },
        relation: "<=",
        rightHandSide: -base.sum + feature.sourceValue * base.count,
      });
      constraints.push({
        id: `feature_${featureIndex}_fixed_down`,
        coefficients: {
          ...Object.fromEntries(Object.entries(deltas).map(([id, value]) => [id, -value])),
          [deviationId]: -base.count,
        },
        relation: "<=",
        rightHandSide: base.sum - feature.sourceValue * base.count,
      });
    }
    return deviationId;
  }
  const selectors = Array.from({ length: maxCount + 1 }, (_, count) => {
    const id = `feature_${featureIndex}_count_${count}`;
    variables.push({ id, lowerBound: 0, upperBound: 1, integer: true });
    return { id, count };
  });
  constraints.push({
    id: `feature_${featureIndex}_count_one`,
    coefficients: Object.fromEntries(selectors.map((selector) => [selector.id, 1])),
    relation: "=",
    rightHandSide: 1,
  });
  constraints.push({
    id: `feature_${featureIndex}_count_link`,
    coefficients: {
      ...Object.fromEntries(
        candidates.map((candidate) => [
          candidate.id,
          candidate.featureDeltas[feature.id]?.count ?? 0,
        ]),
      ),
      ...Object.fromEntries(selectors.map((selector) => [selector.id, -selector.count])),
    },
    relation: "=",
    rightHandSide: -base.count,
  });
  const possibleMagnitude =
    Math.abs(base.sum) +
    Math.abs(feature.sourceValue) * maxCount +
    candidates.reduce(
      (sum, candidate) => sum + Math.abs(candidate.featureDeltas[feature.id]?.sum ?? 0),
      0,
    ) +
    1;
  for (const selector of selectors) {
    if (selector.count === 0) {
      constraints.push({
        id: `feature_${featureIndex}_zero`,
        coefficients: { [deviationId]: 1, [selector.id]: -possibleMagnitude },
        relation: ">=",
        rightHandSide: Math.abs(feature.sourceValue) - possibleMagnitude,
      });
      continue;
    }
    const deltas = Object.fromEntries(
      candidates.map((candidate) => [candidate.id, candidate.featureDeltas[feature.id]?.sum ?? 0]),
    );
    constraints.push({
      id: `feature_${featureIndex}_${selector.count}_up`,
      coefficients: {
        ...deltas,
        [deviationId]: -selector.count,
        [selector.id]: possibleMagnitude,
      },
      relation: "<=",
      rightHandSide: possibleMagnitude - base.sum + feature.sourceValue * selector.count,
    });
    constraints.push({
      id: `feature_${featureIndex}_${selector.count}_down`,
      coefficients: {
        ...Object.fromEntries(Object.entries(deltas).map(([id, value]) => [id, -value])),
        [deviationId]: -selector.count,
        [selector.id]: possibleMagnitude,
      },
      relation: "<=",
      rightHandSide: possibleMagnitude + base.sum - feature.sourceValue * selector.count,
    });
  }
  return deviationId;
};

export const compileGlobalRepair = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: readonly NormalizedResponse[],
  targets: ProjectTargets,
  seed: number,
  advancedFeatures: readonly AdvancedFeature[] = [],
): GlobalRepairPlan => {
  const compiledConstraints = compileTargets(form, original, targets).aggregateConstraints;
  const finalRows = [...original, ...synthetic];
  const baseMetrics = compiledConstraints.map((constraint) =>
    canonicalMetricAggregate(finalRows, constraint.metric),
  );
  const relevantQuestionIds = new Set<QuestionId>();
  for (const target of targets.questionTargets) relevantQuestionIds.add(target.questionId);
  for (const goal of targets.detailedGoals ?? []) {
    relevantQuestionIds.add(goal.outcome.questionId);
    for (const questionId of conditionQuestionIds(goal.condition))
      relevantQuestionIds.add(questionId);
  }
  for (const feature of advancedFeatures) {
    relevantQuestionIds.add(feature.questionA);
    if (feature.questionB !== undefined) relevantQuestionIds.add(feature.questionB);
  }
  const rawCandidates: Omit<
    RepairCandidate,
    "metricDeltas" | "featureDeltas" | "diversityDelta"
  >[] = [];
  candidateGeneration: for (let rowIndex = 0; rowIndex < synthetic.length; rowIndex++) {
    const row = synthetic[rowIndex]!;
    for (const question of form.questions.filter((item) => relevantQuestionIds.has(item.id))) {
      if (question.kind === "single_choice" || question.kind === "multi_choice") {
        for (const option of question.options) {
          const candidate = candidateForOption(
            form,
            original,
            row,
            rowIndex,
            question.id,
            option.key,
            seed + rowIndex,
          );
          if (candidate !== null) rawCandidates.push(candidate);
        }
      }
      if (question.kind === "multi_choice") {
        const answer = slot(row, question.id);
        if (answer.state === "answered" && answer.value.kind === "multi_choice")
          for (let count = 0; count <= question.options.length; count++) {
            const currentOptionKeys = answer.value.optionKeys;
            const optionKeys = [
              ...currentOptionKeys,
              ...question.options
                .map((option) => option.key)
                .filter((key) => !currentOptionKeys.includes(key)),
            ].slice(0, count);
            const candidate = replaceValueCandidate(
              row,
              rowIndex,
              question.id,
              {
                state: "answered",
                value: {
                  kind: "multi_choice",
                  optionKeys,
                  labels: optionKeys.map(
                    (key) => question.options.find((option) => option.key === key)?.label ?? "",
                  ),
                },
              },
              `set_${count}`,
            );
            if (candidate !== null) rawCandidates.push(candidate);
          }
      }
      if (question.kind === "ordinal")
        for (let value = question.min; value <= question.max; value++) {
          const candidate = replaceValueCandidate(
            row,
            rowIndex,
            question.id,
            { state: "answered", value: { kind: "ordinal", value } },
            `value_${value}`,
          );
          if (candidate !== null) rawCandidates.push(candidate);
        }
      if (question.kind === "text") {
        const values = new Set(
          finalRows
            .map((item) => answerNumber(slot(item, question.id)))
            .filter((value): value is number => value !== undefined),
        );
        for (const constraint of compiledConstraints)
          if (constraint.metric.questionId === question.id && constraint.target.kind === "mean")
            values.add(constraint.target.value);
        for (const value of [...values].sort((a, b) => a - b).slice(0, 12)) {
          const candidate = replaceValueCandidate(
            row,
            rowIndex,
            question.id,
            { state: "answered", value: { kind: "text", value: String(value) } },
            `value_${value}`,
          );
          if (candidate !== null) rawCandidates.push(candidate);
        }
      }
      if (rawCandidates.length >= ADVANCED_LIMITS.mutationCandidates * 4) break candidateGeneration;
    }
  }
  const unique = [
    ...new Map(
      rawCandidates.map((candidate) => [
        `${candidate.rowIndex}:${JSON.stringify(candidate.row.answers)}`,
        candidate,
      ]),
    ).values(),
  ];
  const baseFeatureAggregates = new FeatureAccumulator(advancedFeatures, finalRows).aggregates();
  const fingerprints = finalRows.map((row) => JSON.stringify(row.answers));
  const fingerprintCounts = new Map<string, number>();
  for (const fingerprint of fingerprints)
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
  const enriched = unique.map<RepairCandidate>((candidate) => {
    const before = synthetic[candidate.rowIndex]!;
    const metricDeltas = compiledConstraints.map((constraint) => {
      const current = canonicalMetricContribution(before, constraint.metric);
      const changed = canonicalMetricContribution(candidate.row, constraint.metric);
      return {
        numerator: changed.numerator - current.numerator,
        denominator: changed.denominator - current.denominator,
      };
    });
    const featureDeltas = Object.fromEntries(
      advancedFeatures.map((feature) => {
        const current = evaluateAdvancedFeature(before, feature);
        const changed = evaluateAdvancedFeature(candidate.row, feature);
        return [
          feature.id,
          {
            sum: (changed ?? 0) - (current ?? 0),
            count: Number(changed !== null) - Number(current !== null),
          },
        ];
      }),
    );
    const beforeFingerprint = JSON.stringify(before.answers);
    const afterFingerprint = JSON.stringify(candidate.row.answers);
    const beforeCount = fingerprintCounts.get(beforeFingerprint) ?? 0;
    const afterCount = fingerprintCounts.get(afterFingerprint) ?? 0;
    return {
      ...candidate,
      metricDeltas,
      featureDeltas,
      diversityDelta:
        Math.max(0, beforeCount - 2) -
        Math.max(0, beforeCount - 1) +
        Math.max(0, afterCount) -
        Math.max(0, afterCount - 1),
    };
  });
  const ranked = enriched.sort((left, right) => {
    const score = (candidate: RepairCandidate): number =>
      compiledConstraints.reduce((total, constraint, index) => {
        const base = baseMetrics[index]!;
        const delta = candidate.metricDeltas[index]!;
        return (
          total +
          Math.max(
            0,
            hardError(base, constraint) -
              hardError(
                {
                  numerator: base.numerator + delta.numerator,
                  denominator: base.denominator + delta.denominator,
                },
                constraint,
              ),
          )
        );
      }, 0);
    return score(right) - score(left) || left.cost - right.cost || left.id.localeCompare(right.id);
  });
  const candidates = ranked.slice(0, ADVANCED_LIMITS.mutationCandidates);
  const variables: OptimizationProblem["variables"] extends readonly (infer V)[] ? V[] : never =
    candidates.map((candidate) => ({
      id: candidate.id,
      lowerBound: 0,
      upperBound: 1,
      integer: true,
    }));
  const constraints: LinearConstraint[] = [];
  for (const [metricIndex, compiled] of compiledConstraints.entries()) {
    const base = baseMetrics[metricIndex]!;
    const numeratorCoefficients = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        candidate.metricDeltas[metricIndex]?.numerator ?? 0,
      ]),
    );
    const denominatorCoefficients = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        candidate.metricDeltas[metricIndex]?.denominator ?? 0,
      ]),
    );
    if (compiled.target.kind === "count")
      constraints.push({
        id: `hard_${metricIndex}`,
        coefficients: numeratorCoefficients,
        relation: "=",
        rightHandSide: compiled.target.value - base.numerator,
      });
    else if (compiled.target.kind === "count_range") {
      constraints.push({
        id: `range_${metricIndex}_min`,
        coefficients: numeratorCoefficients,
        relation: ">=",
        rightHandSide: compiled.target.min - base.numerator,
      });
      constraints.push({
        id: `range_${metricIndex}_max`,
        coefficients: numeratorCoefficients,
        relation: "<=",
        rightHandSide: compiled.target.max - base.numerator,
      });
    } else if (compiled.target.kind === "ratio") {
      const target = compiled.target;
      addExactDynamicAggregate(
        variables,
        constraints,
        candidates,
        metricIndex,
        base,
        (denominator) => nearestRepresentable(target.value, denominator),
        finalRows.length,
      );
    } else if (compiled.target.kind === "ratio_range") {
      const target = compiled.target;
      constraints.push({
        id: `ratio_range_${metricIndex}_min`,
        coefficients: {
          ...numeratorCoefficients,
          ...Object.fromEntries(
            candidates.map((candidate) => [
              candidate.id,
              (numeratorCoefficients[candidate.id] ?? 0) -
                target.min * (denominatorCoefficients[candidate.id] ?? 0),
            ]),
          ),
        },
        relation: ">=",
        rightHandSide: -(base.numerator - target.min * base.denominator),
      });
      constraints.push({
        id: `ratio_range_${metricIndex}_max`,
        coefficients: Object.fromEntries(
          candidates.map((candidate) => [
            candidate.id,
            (numeratorCoefficients[candidate.id] ?? 0) -
              target.max * (denominatorCoefficients[candidate.id] ?? 0),
          ]),
        ),
        relation: "<=",
        rightHandSide: -(base.numerator - target.max * base.denominator),
      });
    } else {
      const target = compiled.target;
      if (
        compiled.metric.kind === "selection_count_mean" ||
        form.questions.find((question) => question.id === compiled.metric.questionId)?.kind ===
          "ordinal"
      )
        addExactDynamicAggregate(
          variables,
          constraints,
          candidates,
          metricIndex,
          base,
          (denominator) => Math.round(target.value * denominator),
          finalRows.length,
        );
      else
        constraints.push({
          id: `mean_${metricIndex}`,
          coefficients: Object.fromEntries(
            candidates.map((candidate) => [
              candidate.id,
              (numeratorCoefficients[candidate.id] ?? 0) -
                target.value * (denominatorCoefficients[candidate.id] ?? 0),
            ]),
          ),
          relation: "=",
          rightHandSide: -(base.numerator - target.value * base.denominator),
        });
    }
  }
  const conflicts = new Map<number, RepairCandidate[]>();
  for (const candidate of candidates) {
    conflicts.set(candidate.rowIndex, [...(conflicts.get(candidate.rowIndex) ?? []), candidate]);
  }
  let conflictIndex = 0;
  for (const group of conflicts.values())
    if (group.length > 1)
      constraints.push({
        id: `conflict_${conflictIndex++}`,
        coefficients: Object.fromEntries(group.map((candidate) => [candidate.id, 1])),
        relation: "<=",
        rightHandSide: 1,
      });
  const featureObjectives = new Map<AdvancedFeature["priority"], Record<string, number>>([
    ["preserve_marginal", {}],
    ["preserve_relationship", {}],
    ["preserve_temporal", {}],
  ]);
  advancedFeatures.forEach((feature, featureIndex) => {
    const deviationId = addFeatureDeviation(
      variables,
      constraints,
      candidates,
      feature,
      featureIndex,
      baseFeatureAggregates[feature.id] ?? { sum: 0, count: 0 },
      finalRows.length,
    );
    featureObjectives.get(feature.priority)![deviationId] = feature.reliability;
  });
  const objectiveStages = [
    ...(["preserve_marginal", "preserve_relationship", "preserve_temporal"] as const).map(
      (priority) => ({ priority, coefficients: featureObjectives.get(priority)! }),
    ),
    {
      priority: "diversity" as const,
      coefficients: Object.fromEntries(
        candidates.map((candidate) => [candidate.id, candidate.diversityDelta]),
      ),
    },
    {
      priority: "mutation_cost" as const,
      coefficients: Object.fromEntries(
        candidates.map((candidate) => [candidate.id, candidate.cost]),
      ),
    },
    {
      priority: "stable_tie" as const,
      coefficients: Object.fromEntries(
        [...candidates]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((candidate, index) => [candidate.id, index + 1]),
      ),
    },
  ].filter((stage) => Object.values(stage.coefficients).some((coefficient) => coefficient !== 0));
  const firstObjective = objectiveStages[0]?.coefficients ?? {};
  return {
    candidates,
    objectiveStages,
    diagnostics: {
      featureCount: advancedFeatures.length,
      candidateCount: candidates.length,
      generatedCandidateCount: enriched.length,
      prunedCandidateCount: Math.max(0, enriched.length - candidates.length),
      constraintCount: constraints.length,
    },
    problem: {
      variables,
      constraints,
      objective: {
        sense: "minimize",
        coefficients: firstObjective,
      },
    },
  };
};

export const applyGlobalRepair = (
  synthetic: readonly NormalizedResponse[],
  plan: GlobalRepairPlan,
  values: Readonly<Record<string, number>>,
): readonly NormalizedResponse[] => {
  const rows = [...synthetic];
  for (const candidate of plan.candidates) {
    if ((values[candidate.id] ?? 0) < 0.5) continue;
    rows[candidate.rowIndex] = candidate.row;
  }
  return rows;
};

export interface GlobalRepairResult {
  readonly status: OptimizationSolution["status"] | "candidate_limit" | "parity_error";
  readonly rows: readonly NormalizedResponse[] | null;
  readonly diagnostics: GlobalRepairPlan["diagnostics"] & { readonly solverStatus: string };
}

const objectiveValue = (
  coefficients: Readonly<Record<string, number>>,
  values: Readonly<Record<string, number>>,
): number =>
  Object.entries(coefficients).reduce(
    (sum, [id, coefficient]) => sum + coefficient * (values[id] ?? 0),
    0,
  );

export const globalRepairWithDiagnostics = async (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: readonly NormalizedResponse[],
  targets: ProjectTargets,
  seed: number,
  backend: OptimizationBackend,
  signal?: CancellationSignal,
  advancedFeatures: readonly AdvancedFeature[] = [],
): Promise<GlobalRepairResult> => {
  const plan = compileGlobalRepair(form, original, synthetic, targets, seed, advancedFeatures);
  let constraints = [...plan.problem.constraints];
  let solution: OptimizationSolution = { status: "optimal", values: {} };
  for (const [stageIndex, stage] of plan.objectiveStages.entries()) {
    solution = await backend.solveMixedInteger(
      {
        ...plan.problem,
        constraints,
        objective: { sense: "minimize", coefficients: stage.coefficients },
      },
      signal,
    );
    if (solution.status !== "optimal")
      return {
        status:
          solution.status === "infeasible" && plan.diagnostics.prunedCandidateCount > 0
            ? "candidate_limit"
            : solution.status,
        rows: null,
        diagnostics: { ...plan.diagnostics, solverStatus: solution.status },
      };
    constraints = [
      ...constraints,
      {
        id: `priority_freeze_${stageIndex}`,
        coefficients: stage.coefficients,
        relation: "=" as const,
        rightHandSide: objectiveValue(stage.coefficients, solution.values),
      },
    ];
  }
  if (plan.objectiveStages.length === 0)
    solution = await backend.solveMixedInteger(plan.problem, signal);
  if (solution.status !== "optimal")
    return {
      status:
        solution.status === "infeasible" && plan.diagnostics.prunedCandidateCount > 0
          ? "candidate_limit"
          : solution.status,
      rows: null,
      diagnostics: { ...plan.diagnostics, solverStatus: solution.status },
    };
  const rows = applyGlobalRepair(synthetic, plan, solution.values);
  const selected = plan.candidates.filter(
    (candidate) => (solution.values[candidate.id] ?? 0) >= 0.5,
  );
  const predicted = new FeatureAccumulator(advancedFeatures, [
    ...original,
    ...synthetic,
  ]).aggregates();
  const actual = new FeatureAccumulator(advancedFeatures, [...original, ...rows]).aggregates();
  for (const feature of advancedFeatures) {
    const base = predicted[feature.id] ?? { sum: 0, count: 0 };
    const expected = selected.reduce((state, candidate) => {
      const delta = candidate.featureDeltas[feature.id] ?? { sum: 0, count: 0 };
      return { sum: state.sum + delta.sum, count: state.count + delta.count };
    }, base);
    const observed = actual[feature.id] ?? { sum: 0, count: 0 };
    if (Math.abs(expected.sum - observed.sum) > 1e-8 || expected.count !== observed.count)
      return {
        status: "parity_error",
        rows: null,
        diagnostics: { ...plan.diagnostics, solverStatus: "parity_error" },
      };
  }
  return {
    status: "optimal",
    rows,
    diagnostics: { ...plan.diagnostics, solverStatus: "optimal" },
  };
};

export const globalRepair = async (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  synthetic: readonly NormalizedResponse[],
  targets: ProjectTargets,
  seed: number,
  backend: OptimizationBackend,
  signal?: CancellationSignal,
  advancedFeatures: readonly AdvancedFeature[] = [],
): Promise<readonly NormalizedResponse[] | null> => {
  const result = await globalRepairWithDiagnostics(
    form,
    original,
    synthetic,
    targets,
    seed,
    backend,
    signal,
    advancedFeatures,
  );
  return result.rows;
};

export interface PreservationDiagnostics {
  readonly marginalError: number;
  readonly relationshipError: number;
  readonly temporalError: number;
  readonly duplicateRatio: number;
}

export const preservationDiagnostics = (
  source: readonly NormalizedResponse[],
  finalRows: readonly NormalizedResponse[],
  features: readonly AdvancedFeature[],
): PreservationDiagnostics => {
  const finalValues = new FeatureAccumulator(features, finalRows).values();
  const errors = (priority: AdvancedFeature["priority"]): number[] =>
    features
      .filter((feature) => feature.priority === priority)
      .map(
        (feature) =>
          Math.abs((finalValues[feature.id] ?? 0) - feature.sourceValue) * feature.reliability,
      );
  const fingerprints = finalRows.map((row) => JSON.stringify(row.answers));
  return {
    marginalError: mean(errors("preserve_marginal")),
    relationshipError: mean(errors("preserve_relationship")),
    temporalError: mean(errors("preserve_temporal")),
    duplicateRatio:
      fingerprints.length === 0 ? 0 : 1 - new Set(fingerprints).size / fingerprints.length,
  };
};
