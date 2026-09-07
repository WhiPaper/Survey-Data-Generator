import type { TargetIntent, TargetOutcome } from "@survey-synth/contracts";

const goalValue = (outcome: TargetOutcome): string => {
  if (outcome.kind === "share" || outcome.kind === "conditional_share") {
    return `${(outcome.requested * 100).toFixed(1)}%`;
  }
  if (outcome.kind === "count") return `${Math.round(outcome.requested)}명`;
  return outcome.requested.toFixed(2);
};

const signed = (value: number, suffix: string): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

export const runIntentLabel = (
  intent: TargetIntent | undefined,
  outcome: TargetOutcome,
): string => {
  const goal = `목표 ${goalValue(outcome)}`;
  if (!intent || intent.kind === "absolute") return goal;
  if (intent.kind === "count_delta") return `${intent.value > 0 ? "+" : ""}${intent.value}명 / ${goal}`;
  if (intent.kind === "percentage_point_delta") {
    return `${signed(intent.value * 100, "%p")} / ${goal}`;
  }
  return `${signed(intent.value * 100, "%")} / ${goal}`;
};
