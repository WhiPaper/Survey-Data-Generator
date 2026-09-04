import type { ChoiceOption, ProjectTargets, QuestionTarget } from "@survey-synth/domain";

const choiceTargetFor = (
  targets: ProjectTargets,
  questionId: string,
  optionKey: string,
): Extract<QuestionTarget, { kind: "option" }> | undefined =>
  targets.questionTargets.find(
    (target) =>
      target.kind === "option" &&
      target.questionId === questionId &&
      target.optionKey === optionKey,
  ) as Extract<QuestionTarget, { kind: "option" }> | undefined;

export const targetRatio = (
  target: QuestionTarget["target"],
  total: number,
): number | undefined => {
  if (target.kind === "ratio") return target.value;
  if (target.kind === "count") return total === 0 ? 0 : target.value / total;
  return undefined;
};

export const deriveSingleChoiceRatios = (
  options: readonly ChoiceOption[],
  currentShares: Readonly<Record<string, number>>,
  targets: ProjectTargets,
  questionId: string,
): ReadonlyMap<string, number> => {
  const current = new Map(options.map((option) => [option.key, currentShares[option.key] ?? 0]));
  const explicit = options.flatMap((option) => {
    const target = choiceTargetFor(targets, questionId, option.key);
    if (target === undefined) return [];
    const ratio = targetRatio(target.target, targets.targetResponseCount);
    return ratio === undefined ? [] : [[option.key, ratio] as const];
  });
  const explicitKeys = new Set(explicit.map(([key]) => key));
  const remaining = options.filter((option) => !explicitKeys.has(option.key));
  const remainingCurrent = remaining.reduce(
    (sum, option) => sum + (current.get(option.key) ?? 0),
    0,
  );
  const available = Math.max(0, 1 - explicit.reduce((sum, [, ratio]) => sum + ratio, 0));
  const next = new Map(explicit);

  for (const option of remaining) {
    const currentRatio = current.get(option.key) ?? 0;
    next.set(
      option.key,
      remaining.length === 0
        ? 0
        : remainingCurrent === 0
          ? available / remaining.length
          : (currentRatio / remainingCurrent) * available,
    );
  }
  return next;
};

export const splitDistributionAdjustment = (source: number, target: number) => ({
  existing: Math.min(source, target),
  increase: Math.max(0, target - source),
  decrease: Math.max(0, source - target),
});
