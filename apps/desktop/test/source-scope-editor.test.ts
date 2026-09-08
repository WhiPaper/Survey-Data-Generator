import { describe, expect, it } from "vitest";

import {
  sourceScopeEditorError,
  sourceScopesEqual,
} from "../src/QuestionExplorerPanel/sourceScopeEditor";

describe("source scope editor", () => {
  it("compares applied scopes without deriving profile data", () => {
    expect(sourceScopesEqual({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(
      sourceScopesEqual(
        {
          kind: "submitted_between",
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-08-02T00:00:00.000Z",
        },
        {
          kind: "submitted_between",
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-08-02T00:00:00.000Z",
        },
      ),
    ).toBe(true);
    expect(
      sourceScopesEqual(
        {
          kind: "submitted_between",
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-08-02T00:00:00.000Z",
        },
        {
          kind: "submitted_between",
          start: "2026-08-01T00:00:00.000Z",
          end: "2026-08-03T00:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("only validates editor input ordering", () => {
    expect(sourceScopeEditorError({ kind: "all" })).toBeNull();
    expect(
      sourceScopeEditorError({
        kind: "submitted_between",
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-08-02T00:00:00.000Z",
      }),
    ).toBe("시작 시각은 종료 시각보다 늦을 수 없습니다.");
  });
});
