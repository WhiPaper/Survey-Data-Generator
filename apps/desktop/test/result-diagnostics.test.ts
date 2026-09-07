import { describe, expect, it } from "vitest";

import type { RunsGetResult } from "@survey-synth/contracts";
import { resultDiagnosticsLines } from "../src/QuestionExplorerPanel/resultDiagnostics";

const runWith = (
  sourceScope: RunsGetResult["targetSnapshot"]["sourceScope"],
  diagnostics: RunsGetResult["diagnostics"],
): RunsGetResult =>
  ({
    targetSnapshot: { sourceScope },
    diagnostics,
  }) as RunsGetResult;

describe("Result diagnostics copy", () => {
  it("shows frozen all-response scope without dashboard terminology", () => {
    expect(
      resultDiagnosticsLines(
        runWith(
          { kind: "all" },
          {
            sourceResponseCount: 80,
            syntheticResponseCount: 40,
            replacementCount: 0,
            structuralValidation: "passed",
          },
        ),
      ),
    ).toEqual(["생성 당시 범위 전체 응답 · 원본 80명", "새로 만든 응답 40명 · 구조 확인 완료"]);
  });

  it("shows historical date scope and explicit replacement count", () => {
    expect(
      resultDiagnosticsLines(
        runWith(
          {
            kind: "submitted_between",
            start: "2026-08-01T00:00:00.000Z",
            end: "2026-08-02T23:59:59.999Z",
          },
          {
            sourceResponseCount: 80,
            syntheticResponseCount: 42,
            replacementCount: 2,
            structuralValidation: "unknown",
          },
        ),
      ),
    ).toEqual([
      "생성 당시 범위 2026-08-01 ~ 2026-08-02 · 원본 80명",
      "새로 만든 응답 42명 · 원본 대체 2명 · 구조 확인 정보 없음",
    ]);
  });
});
