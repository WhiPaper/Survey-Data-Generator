import type { RunTargetBaseline } from "@survey-synth/contracts";

import { formatShare } from "./model";

export const runBaselineValue = (baseline: RunTargetBaseline | undefined): string => {
  if (!baseline) return "—";
  if (baseline.kind === "count") return `${baseline.count}명`;
  if (baseline.kind === "mean") return baseline.mean.toFixed(2);
  return formatShare(baseline.share);
};
