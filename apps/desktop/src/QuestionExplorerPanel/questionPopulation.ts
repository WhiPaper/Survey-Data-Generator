import type { TargetProfileResult } from "@survey-synth/contracts";

import {
  kindLabel,
  ordinalDistributionMetric,
  subjectMetricFor,
  type QuestionView,
} from "./model";

const choiceDenominator = (
  question: QuestionView,
  profile: TargetProfileResult | null,
  subjectKind: "option" | "checkbox_option",
): number =>
  question.options
    .map((option) => subjectMetricFor(profile, subjectKind, question.id, option.key))
    .find((metric) => metric !== undefined)?.denominatorCount ?? 0;

export const questionPopulationText = (
  question: QuestionView,
  profile: TargetProfileResult | null,
  sourceCount: number,
): string => {
  if (question.kind === "single_choice") {
    return `${kindLabel(question.kind)} · 응답 대상 ${choiceDenominator(question, profile, "option")}명`;
  }
  if (question.kind === "multi_choice") {
    return `${kindLabel(question.kind)} · 응답 대상 ${choiceDenominator(question, profile, "checkbox_option")}명`;
  }
  if (question.kind === "ordinal") {
    const denominator = ordinalDistributionMetric(profile, question.id)?.denominatorCount ?? 0;
    return `${kindLabel(question.kind)} · 응답 ${denominator}명`;
  }
  if (question.kind === "text") {
    return `${kindLabel(question.kind)} · 선택 범위 ${sourceCount}명`;
  }
  return `${kindLabel(question.kind)} · 선택 범위 ${sourceCount}명`;
};
