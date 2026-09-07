import { describe, expect, it } from "vitest";

import {
  targetKindForMode,
  targetModeAllowed,
} from "../src/QuestionExplorerPanel/targetModePolicy";

describe("Question Explorer target mode policy", () => {
  it("allows count modes for ordinary subjects such as ValueGroups", () => {
    expect(targetModeAllowed("absolute_count", false)).toBe(true);
    expect(targetModeAllowed("count_delta", false)).toBe(true);
    expect(targetKindForMode("absolute_count")).toBe("count");
    expect(targetKindForMode("count_delta")).toBe("count");
  });

  it("keeps conditional-share targets share-only", () => {
    expect(targetModeAllowed("absolute_share", true)).toBe(true);
    expect(targetModeAllowed("percentage_point_delta", true)).toBe(true);
    expect(targetModeAllowed("relative_percent_delta", true)).toBe(true);
    expect(targetModeAllowed("absolute_count", true)).toBe(false);
    expect(targetModeAllowed("count_delta", true)).toBe(false);
  });

  it("maps every share mode to a share target", () => {
    expect(targetKindForMode("absolute_share")).toBe("share");
    expect(targetKindForMode("percentage_point_delta")).toBe("share");
    expect(targetKindForMode("relative_percent_delta")).toBe("share");
  });
});
