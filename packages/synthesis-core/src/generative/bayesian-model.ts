import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  OptionKey,
  QuestionId,
} from "@survey-synth/domain";

export interface CategoricalDistribution {
  readonly options: readonly {
    readonly key: OptionKey;
    readonly label: string;
    readonly probability: number;
  }[];
  readonly conditional: Readonly<
    Record<
      string, // `${parentQuestionId}:${parentOptionKey}`
      readonly { readonly key: OptionKey; readonly probability: number }[]
    >
  >;
}

export interface MultiChoiceDistribution {
  readonly optionProbabilities: Readonly<Record<string, number>>;
  readonly selectionCountProbabilities: readonly number[]; // index = count
}

export interface OrdinalDistribution {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly levelProbabilities: readonly number[]; // index = level - min
}

export interface TextDistribution {
  readonly observedValues: readonly { readonly value: string; readonly weight: number }[];
  readonly emptyRate: number;
}

export interface BayesianFormModel {
  readonly singleChoice: Readonly<Record<QuestionId, CategoricalDistribution>>;
  readonly multiChoice: Readonly<Record<QuestionId, MultiChoiceDistribution>>;
  readonly ordinal: Readonly<Record<QuestionId, OrdinalDistribution>>;
  readonly text: Readonly<Record<QuestionId, TextDistribution>>;
}

const slotFor = (response: NormalizedResponse, questionId: QuestionId): AnswerSlot =>
  response.answers[questionId] ?? { state: "indeterminate" };

/**
 * Builds Bayesian-smoothed conditional and marginal probability distributions
 * for all questions in the FormSnapshot using observed responses and Dirichlet priors.
 */
export const buildBayesianFormModel = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  smoothingAlpha = 0.5,
): BayesianFormModel => {
  const singleChoice: Record<QuestionId, CategoricalDistribution> = {};
  const multiChoice: Record<QuestionId, MultiChoiceDistribution> = {};
  const ordinal: Record<QuestionId, OrdinalDistribution> = {};
  const text: Record<QuestionId, TextDistribution> = {};

  // 1. Process SingleChoice questions
  for (const question of form.questions) {
    if (question.kind !== "single_choice") continue;

    const options = question.options;
    const K = Math.max(1, options.length);
    const counts = new Map<OptionKey, number>();
    for (const opt of options) counts.set(opt.key, 0);

    let totalAnswered = 0;
    for (const row of original) {
      const answer = slotFor(row, question.id);
      if (answer.state === "answered" && answer.value.kind === "single_choice") {
        totalAnswered += 1;
        const current = counts.get(answer.value.optionKey) ?? 0;
        counts.set(answer.value.optionKey, current + 1);
      }
    }

    // Smoothed marginals: (count + alpha) / (total + alpha * K)
    const marginalDenominator = totalAnswered + smoothingAlpha * K;
    const marginals = options.map((opt) => ({
      key: opt.key,
      label: opt.label,
      probability: ((counts.get(opt.key) ?? 0) + smoothingAlpha) / marginalDenominator,
    }));

    // Conditional distributions: P(Q_current = opt | Q_parent = parentOpt)
    const conditional: Record<
      string,
      readonly { readonly key: OptionKey; readonly probability: number }[]
    > = {};

    for (const parentQ of form.questions) {
      if (parentQ.id === question.id || parentQ.kind !== "single_choice") continue;

      for (const parentOpt of parentQ.options) {
        const parentKey = `${parentQ.id}:${parentOpt.key}`;
        const jointCounts = new Map<OptionKey, number>();
        for (const opt of options) jointCounts.set(opt.key, 0);
        let parentTotal = 0;

        for (const row of original) {
          const parentAns = slotFor(row, parentQ.id);
          if (
            parentAns.state === "answered" &&
            parentAns.value.kind === "single_choice" &&
            parentAns.value.optionKey === parentOpt.key
          ) {
            const currentAns = slotFor(row, question.id);
            if (currentAns.state === "answered" && currentAns.value.kind === "single_choice") {
              parentTotal += 1;
              const cur = jointCounts.get(currentAns.value.optionKey) ?? 0;
              jointCounts.set(currentAns.value.optionKey, cur + 1);
            }
          }
        }

        // Bayesian shrinkage towards marginal:
        // P(opt | parent) = (jointCount + smoothingAlpha * P_marginal) / (parentTotal + smoothingAlpha)
        const condDenominator = parentTotal + smoothingAlpha;
        conditional[parentKey] = marginals.map((m) => {
          const joint = jointCounts.get(m.key) ?? 0;
          return {
            key: m.key,
            probability: (joint + smoothingAlpha * m.probability) / condDenominator,
          };
        });
      }
    }

    singleChoice[question.id] = {
      options: marginals,
      conditional,
    };
  }

  // 2. Process MultiChoice questions
  for (const question of form.questions) {
    if (question.kind !== "multi_choice") continue;

    const options = question.options;
    const optionCounts = new Map<string, number>();
    for (const opt of options) optionCounts.set(opt.key, 0);

    const selectionCountFreq = new Map<number, number>();
    for (let i = 0; i <= options.length; i += 1) selectionCountFreq.set(i, 0);

    let totalAnswered = 0;
    for (const row of original) {
      const answer = slotFor(row, question.id);
      if (answer.state === "answered" && answer.value.kind === "multi_choice") {
        totalAnswered += 1;
        const selected = answer.value.optionKeys;
        const selCount = selected.length;
        selectionCountFreq.set(selCount, (selectionCountFreq.get(selCount) ?? 0) + 1);
        for (const key of selected) {
          optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const optProbs: Record<string, number> = {};
    for (const opt of options) {
      const cnt = optionCounts.get(opt.key) ?? 0;
      optProbs[opt.key] = (cnt + smoothingAlpha) / (totalAnswered + 2 * smoothingAlpha);
    }

    const selCountDenom = totalAnswered + smoothingAlpha * (options.length + 1);
    const selCountProbs: number[] = [];
    for (let i = 0; i <= options.length; i += 1) {
      selCountProbs.push(((selectionCountFreq.get(i) ?? 0) + smoothingAlpha) / selCountDenom);
    }

    multiChoice[question.id] = {
      optionProbabilities: optProbs,
      selectionCountProbabilities: selCountProbs,
    };
  }

  // 3. Process Ordinal questions
  for (const question of form.questions) {
    if (question.kind !== "ordinal") continue;

    const min = question.min;
    const max = question.max;
    const levels = max - min + 1;
    const levelCounts = new Map<number, number>();
    for (let v = min; v <= max; v += 1) levelCounts.set(v, 0);

    const values: number[] = [];
    for (const row of original) {
      const answer = slotFor(row, question.id);
      if (answer.state === "answered" && answer.value.kind === "ordinal") {
        const val = answer.value.value;
        values.push(val);
        levelCounts.set(val, (levelCounts.get(val) ?? 0) + 1);
      }
    }

    const mean = values.length > 0
      ? values.reduce((s, v) => s + v, 0) / values.length
      : (min + max) / 2;
    const variance = values.length > 1
      ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
      : 1.0;
    const stdDev = Math.sqrt(variance) || 1.0;

    const denom = values.length + smoothingAlpha * levels;
    const levelProbabilities: number[] = [];
    for (let v = min; v <= max; v += 1) {
      levelProbabilities.push(((levelCounts.get(v) ?? 0) + smoothingAlpha) / denom);
    }

    ordinal[question.id] = {
      min,
      max,
      mean,
      stdDev,
      levelProbabilities,
    };
  }

  // 4. Process Text questions
  for (const question of form.questions) {
    if (question.kind !== "text") continue;

    const textCounts = new Map<string, number>();
    let emptyCount = 0;
    let total = 0;

    for (const row of original) {
      const answer = slotFor(row, question.id);
      total += 1;
      if (
        answer.state !== "answered" ||
        answer.value.kind !== "text" ||
        !answer.value.value.trim()
      ) {
        emptyCount += 1;
      } else {
        const txt = answer.value.value.trim();
        textCounts.set(txt, (textCounts.get(txt) ?? 0) + 1);
      }
    }

    const observedValues = Array.from(textCounts.entries()).map(([value, weight]) => ({
      value,
      weight,
    }));

    text[question.id] = {
      observedValues,
      emptyRate: total > 0 ? emptyCount / total : 0.8,
    };
  }

  return { singleChoice, multiChoice, ordinal, text };
};
