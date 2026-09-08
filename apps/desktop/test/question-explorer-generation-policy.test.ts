import { describe, expect, it } from "vitest";

import { generationBlockReason } from "../src/QuestionExplorerPanel/generationPolicy";

describe("Question Explorer generation policy", () => {
  it("allows targetless generation when the final count adds responses", () => {
    expect(generationBlockReason({ sourceCount: 184, finalCount: 300, targetCount: 0 })).toBeNull();
  });

  it("blocks a targetless no-op with a dedicated reason", () => {
    expect(generationBlockReason({ sourceCount: 184, finalCount: 184, targetCount: 0 })).toBe(
      "no_additions",
    );
  });

  it("preserves existing target-based generation at the source count", () => {
    expect(generationBlockReason({ sourceCount: 184, finalCount: 184, targetCount: 1 })).toBeNull();
  });

  it("keeps final counts below the source count invalid", () => {
    expect(generationBlockReason({ sourceCount: 184, finalCount: 183, targetCount: 0 })).toBe(
      "final_count_below_source",
    );
  });
});
