import { describe, expect, it } from "vitest";

import { parseWorkspaceRoute, workspaceRoutePath } from "../src/hooks/use-workspace-route";

describe("workspace route", () => {
  it("parses the project screens", () => {
    expect(parseWorkspaceRoute("/projects/p-1")).toEqual({
      projectId: "p-1",
      view: "home",
      questionId: null,
      runId: null,
    });
    expect(parseWorkspaceRoute("/projects/p-1/survey/q-2").view).toBe("survey");
    expect(parseWorkspaceRoute("/projects/p-1/targets").view).toBe("targets");
    expect(parseWorkspaceRoute("/projects/p-1/runs/r-3").runId).toBe("r-3");
  });

  it("round-trips encoded identifiers and treats malformed paths as projects home", () => {
    const route = {
      projectId: "project/1",
      view: "survey" as const,
      questionId: "question 2",
      runId: null,
    };
    expect(parseWorkspaceRoute(workspaceRoutePath(route))).toEqual(route);
    expect(parseWorkspaceRoute("/projects/%E0%A4%A").projectId).toBe("%E0%A4%A");
  });

  it("keeps non-project paths at the project index", () => {
    expect(parseWorkspaceRoute("/")).toEqual({
      projectId: null,
      view: "home",
      questionId: null,
      runId: null,
    });
  });
});
