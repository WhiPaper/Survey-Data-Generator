import type { ValueGroupObservedValue } from "@survey-synth/contracts";

export const RAW_VALUE_PAGE_SIZE = 80;

export const rawValuePage = (
  values: readonly ValueGroupObservedValue[],
  visibleCount: number,
): { items: ValueGroupObservedValue[]; hasMore: boolean } => ({
  items: values.slice(0, visibleCount),
  hasMore: values.length > visibleCount,
});
