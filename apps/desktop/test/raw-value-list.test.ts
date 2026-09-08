import { describe, expect, it } from "vitest";

import { RAW_VALUE_PAGE_SIZE, rawValuePage } from "../src/QuestionExplorerPanel/rawValueList";

const values = Array.from({ length: 101 }, (_, index) => ({
  value: `value-${index}`,
  label: `응답 ${index}`,
  count: 1,
}));

describe("raw value list", () => {
  it("shows an explicit first page without losing the remaining search matches", () => {
    expect(rawValuePage(values, RAW_VALUE_PAGE_SIZE)).toMatchObject({
      items: values.slice(0, 80),
      hasMore: true,
    });
  });

  it("ends the continuation affordance when every match is visible", () => {
    expect(rawValuePage(values, 160)).toEqual({ items: values, hasMore: false });
  });
});
