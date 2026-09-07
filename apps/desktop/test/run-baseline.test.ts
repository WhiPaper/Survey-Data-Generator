import { describe, expect, it } from "vitest";

import { runBaselineValue } from "../src/QuestionExplorerPanel/runBaseline";

describe("historical Run baseline formatting", () => {
  it("formats each public baseline kind without current profile state", () => {
    expect(runBaselineValue({ targetId: "count" as never, kind: "count", count: 12 })).toBe("12명");
    expect(
      runBaselineValue({
        targetId: "share" as never,
        kind: "share",
        count: 1,
        denominatorCount: 4,
        share: 0.25,
      }),
    ).toBe("25.0%");
    expect(
      runBaselineValue({
        targetId: "mean" as never,
        kind: "mean",
        mean: 4.25,
        denominatorCount: 8,
      }),
    ).toBe("4.25");
    expect(
      runBaselineValue({
        targetId: "conditional" as never,
        kind: "conditional_share",
        count: 2,
        denominatorCount: 5,
        share: 0.4,
      }),
    ).toBe("40.0%");
  });
});
