import type { RunTargetPresentation } from "@survey-synth/contracts";

export const runPresentationLabel = (presentation: RunTargetPresentation | undefined): string => {
  if (!presentation) return "목표";
  return presentation.populationLabel
    ? `${presentation.populationLabel} 중 ${presentation.subjectLabel}`
    : presentation.subjectLabel;
};
