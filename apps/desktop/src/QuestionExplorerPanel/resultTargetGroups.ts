import type { RunTargetPresentation, TargetOutcome } from "@survey-synth/contracts";

export type ResultTargetGroup = {
  questionId: string;
  questionOrder: number;
  questionTitle: string;
  outcomes: TargetOutcome[];
};

export const resultTargetGroups = (
  outcomes: readonly TargetOutcome[],
  presentations: readonly RunTargetPresentation[],
): ResultTargetGroup[] => {
  const groups = new Map<string, ResultTargetGroup>();

  for (const outcome of outcomes) {
    const presentation = presentations.find(
      (candidate) => String(candidate.targetId) === String(outcome.targetId),
    );
    if (!presentation) continue;

    const group = groups.get(presentation.questionId);
    if (group) {
      group.outcomes.push(outcome);
      continue;
    }

    groups.set(presentation.questionId, {
      questionId: presentation.questionId,
      questionOrder: presentation.questionOrder,
      questionTitle: presentation.questionTitle,
      outcomes: [outcome],
    });
  }

  return [...groups.values()].sort((left, right) => left.questionOrder - right.questionOrder);
};
