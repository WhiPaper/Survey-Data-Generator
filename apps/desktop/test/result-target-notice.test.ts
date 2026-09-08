import { describe, expect, it } from "vitest";

import { resultTargetNotice } from "../src/QuestionExplorerPanel/resultDiagnostics";

describe("targetless Result notice", () => {
  it("shows the planned empty-target copy", () => {
    expect(resultTargetNotice({ outcome: { targets: [] } })).toBe("설정한 분포 목표가 없습니다.");
  });

  it("does not add a notice when target outcomes exist", () => {
    expect(
      resultTargetNotice({
        outcome: {
          targets: [
            {
              targetId: "t-1" as never,
              kind: "count",
              requested: 2,
              achieved: 2,
              absoluteError: 0,
              exact: true,
              numeratorCount: 2,
            },
          ],
        },
      }),
    ).toBeNull();
  });
});
