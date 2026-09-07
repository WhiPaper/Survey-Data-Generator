import { describe, expect, it } from "vitest";

import { runPresentationLabel } from "../src/QuestionExplorerPanel/runPresentation";

describe("Result historical presentation labels", () => {
  it("uses the historical subject label directly", () => {
    expect(
      runPresentationLabel({
        targetId: "t-share" as never,
        questionId: "q-segment",
        questionTitle: "관심 분야",
        subjectLabel: "축제",
      }),
    ).toBe("축제");
  });

  it("composes conditional labels only from frozen presentation fields", () => {
    expect(
      runPresentationLabel({
        targetId: "t-conditional" as never,
        questionId: "q-channel",
        questionTitle: "선호 채널",
        subjectLabel: "음악",
        populationLabel: "행사 관심",
      }),
    ).toBe("행사 관심 중 음악");
  });
});
