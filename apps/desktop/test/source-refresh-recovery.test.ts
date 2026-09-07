import { describe, expect, it, vi } from "vitest";

import type { ProjectDetailView, ProjectSourceReviewResult } from "@survey-synth/contracts";
import { recoverAppliedSourceRefresh } from "../src/sourceRefreshRecovery";

const projectAt = (revisionId: string): ProjectDetailView =>
  ({
    id: "project-1",
    currentSourceRevisionId: revisionId,
  }) as ProjectDetailView;

const reviewAt = (revisionId: string): ProjectSourceReviewResult =>
  ({
    projectId: "project-1",
    sourceRevisionId: revisionId,
    invalidValueGroupIds: [],
    targetIssues: [],
  }) as ProjectSourceReviewResult;

describe("source refresh recovery", () => {
  it("does not infer an applied refresh when the current revision did not change", async () => {
    const getSourceReview = vi.fn(async () => reviewAt("revision-1"));
    await expect(
      recoverAppliedSourceRefresh({
        projectId: "project-1",
        previousSourceRevisionId: "revision-1",
        getProject: async () => projectAt("revision-1"),
        getSourceReview,
      }),
    ).resolves.toEqual({ status: "not_applied" });
    expect(getSourceReview).not.toHaveBeenCalled();
  });

  it("keeps an advanced revision and retries local review", async () => {
    const review = reviewAt("revision-2");
    await expect(
      recoverAppliedSourceRefresh({
        projectId: "project-1",
        previousSourceRevisionId: "revision-1",
        getProject: async () => projectAt("revision-2"),
        getSourceReview: async () => review,
      }),
    ).resolves.toEqual({
      status: "applied",
      project: projectAt("revision-2"),
      review,
    });
  });

  it("keeps an advanced revision when local review is still unavailable", async () => {
    await expect(
      recoverAppliedSourceRefresh({
        projectId: "project-1",
        previousSourceRevisionId: "revision-1",
        getProject: async () => projectAt("revision-2"),
        getSourceReview: async () => {
          throw new Error("review unavailable");
        },
      }),
    ).resolves.toEqual({
      status: "applied",
      project: projectAt("revision-2"),
      review: null,
    });
  });

  it("preserves the original failure when local Project state cannot be read", async () => {
    await expect(
      recoverAppliedSourceRefresh({
        projectId: "project-1",
        previousSourceRevisionId: "revision-1",
        getProject: async () => {
          throw new Error("project unavailable");
        },
        getSourceReview: async () => reviewAt("revision-2"),
      }),
    ).resolves.toEqual({ status: "not_applied" });
  });
});
