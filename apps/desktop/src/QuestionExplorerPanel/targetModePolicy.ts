import type { TargetMode } from "./model";

const countMode = (mode: TargetMode): boolean =>
  mode === "absolute_count" || mode === "count_delta";

export const targetModeAllowed = (mode: TargetMode, conditionalMode: boolean): boolean =>
  !conditionalMode || !countMode(mode);

export const targetKindForMode = (mode: TargetMode): "count" | "share" =>
  countMode(mode) ? "count" : "share";

export const resolvedCountForMode = (
  mode: TargetMode,
  currentCount: number,
  value: number,
): number | null => {
  if (mode === "absolute_count") return value;
  if (mode === "count_delta") return currentCount + value;
  return null;
};
