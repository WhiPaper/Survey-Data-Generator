import type { TargetMode } from "./model";

const countMode = (mode: TargetMode): boolean =>
  mode === "absolute_count" || mode === "count_delta";

export const targetModeAllowed = (mode: TargetMode, conditionalMode: boolean): boolean =>
  !conditionalMode || !countMode(mode);

export const targetKindForMode = (mode: TargetMode): "count" | "share" =>
  countMode(mode) ? "count" : "share";
