import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  QuestionId,
} from "@survey-synth/domain";
import { buildBayesianFormModel } from "./bayesian-model.js";
import { sampleDagResponse } from "./dag-sampler.js";
import {
  detectTemporalWindow,
  generateSyntheticTimestamps,
} from "./temporal-sampler.js";

export * from "./bayesian-model.js";
export * from "./copula-coupling.js";
export * from "./dag-sampler.js";
export * from "./temporal-sampler.js";

const answerSignature = (answers: Readonly<Record<QuestionId, AnswerSlot>>): string => {
  return Object.entries(answers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([qId, slot]) => {
      if (slot.state !== "answered") return `${qId}:${slot.state}`;
      const v = slot.value;
      switch (v.kind) {
        case "single_choice":
          return `${qId}:${v.optionKey}:${JSON.stringify(v.otherValue ?? null)}`;
        case "multi_choice":
          return `${qId}:${[...v.optionKeys].sort().join(",")}:${JSON.stringify(v.otherValue ?? null)}`;
        case "ordinal":
          return `${qId}:${v.value}`;
        case "text":
          return `${qId}:${v.value.trim()}`;
        case "date":
        case "time":
          return `${qId}:${v.value}`;
        default:
          return `${qId}:other`;
      }
    })
    .join("|");
};

/**
 * Generates a diverse, structurally valid synthetic dataset:
 * - Traverses FormLogic DAG (100% compliant with sections and branch rules)
 * - Samples from Bayesian-smoothed conditional distributions
 * - Preserves inter-item correlation across Likert/satisfaction questions
 * - Assigns collision-free, chronological synthetic timestamps
 * - Eliminates 100% duplicate cloning
 */
export const generateSyntheticDataset = (
  form: FormSnapshot,
  original: readonly NormalizedResponse[],
  targetSyntheticCount: number,
  seed: number,
): readonly NormalizedResponse[] => {
  if (targetSyntheticCount <= 0) return [];

  const window = detectTemporalWindow(original);
  const timestamps = generateSyntheticTimestamps(targetSyntheticCount, window, seed);
  const model = buildBayesianFormModel(form, original, 0.5);

  const existingSignatures = new Set<string>();
  for (const row of original) {
    existingSignatures.add(answerSignature(row.answers));
  }

  const synthetic: NormalizedResponse[] = [];
  for (let i = 0; i < targetSyntheticCount; i += 1) {
    const timestamp = timestamps[i]!;
    const { response, signature } = sampleDagResponse(
      form,
      model,
      i,
      seed,
      timestamp,
      existingSignatures,
    );
    existingSignatures.add(signature);
    synthetic.push(response);
  }

  return synthetic;
};
