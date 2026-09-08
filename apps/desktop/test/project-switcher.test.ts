import { describe, expect, it } from "vitest";

import type { ProjectSummaryView } from "@survey-synth/contracts";
import {
  filterProjectChoices,
  promoteProjectChoice,
  recentProjectChoices,
} from "../src/projectSwitcher";

const project = (id: string, name: string): ProjectSummaryView => ({
  id,
  googleAccountId: "account-1" as never,
  googleFormId: `form-${id}` as never,
  name,
  currentSourceRevisionId: `revision-${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  responseCount: 10,
  questionCount: 2,
});

describe("project switcher choices", () => {
  const projects = [
    project("one", "Alpha Survey"),
    project("two", "Beta Study"),
    project("three", "Gamma"),
  ];

  it("keeps the persisted order while excluding the current project from recent choices", () => {
    expect(recentProjectChoices(projects, "one").map((item) => item.id)).toEqual(["two", "three"]);
  });

  it("searches project names without changing backend data", () => {
    expect(filterProjectChoices(projects, " beta ").map((item) => item.id)).toEqual(["two"]);
    expect(projects.map((item) => item.id)).toEqual(["one", "two", "three"]);
  });

  it("promotes a successfully opened project for immediate switcher feedback", () => {
    expect(promoteProjectChoice(projects, "three").map((item) => item.id)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });
});
