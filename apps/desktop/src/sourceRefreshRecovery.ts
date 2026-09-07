import type { ProjectDetailView, ProjectSourceReviewResult } from "@survey-synth/contracts";

type RecoveryDependencies = {
  getProject(projectId: string): Promise<ProjectDetailView | null>;
  getSourceReview(projectId: string): Promise<ProjectSourceReviewResult>;
};

export type SourceRefreshRecovery =
  | { status: "not_applied" }
  | {
      status: "applied";
      project: ProjectDetailView;
      review: ProjectSourceReviewResult | null;
    };

export const recoverAppliedSourceRefresh = async ({
  projectId,
  previousSourceRevisionId,
  getProject,
  getSourceReview,
}: {
  projectId: string;
  previousSourceRevisionId: ProjectDetailView["currentSourceRevisionId"];
} & RecoveryDependencies): Promise<SourceRefreshRecovery> => {
  let project: ProjectDetailView | null;
  try {
    project = await getProject(projectId);
  } catch {
    return { status: "not_applied" };
  }

  if (
    project === null ||
    project.currentSourceRevisionId === null ||
    project.currentSourceRevisionId === previousSourceRevisionId
  ) {
    return { status: "not_applied" };
  }

  try {
    return {
      status: "applied",
      project,
      review: await getSourceReview(projectId),
    };
  } catch {
    return { status: "applied", project, review: null };
  }
};
