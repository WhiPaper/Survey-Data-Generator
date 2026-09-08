import { eq } from "drizzle-orm";

import type {
  FormId,
  FrozenRunTarget,
  GoogleAccountId,
  ProjectDetailView,
  ProjectSummaryView,
  RunTargetPresentation,
} from "@survey-synth/contracts";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { formSnapshots, projects } from "../persistence/schema";
import {
  getActiveGoogleAccountId,
  getProject,
  getRecentProjectIds,
  getSourceRevision,
  listProjects,
  listSourceResponses,
  recordRecentProject,
  removeRecentProject,
  type ProjectRecord,
  type SourceRevisionRecord,
} from "../persistence/store";
import { invalidValueGroupIdsForCurrentSource } from "../value-groups/service";
import { buildRunTargetPresentations } from "./run-presentation";

export interface ProjectService {
  list(): Promise<ProjectSummaryView[]>;
  get(projectId: string): Promise<ProjectDetailView | null>;
  open(projectId: string): Promise<ProjectDetailView | null>;
  sourceReview(projectId: string): Promise<{
    sourceRevisionId: string;
    invalidValueGroupIds: string[];
  }>;
  runTargetPresentations(
    projectId: string,
    sourceRevisionId: string,
    targets: readonly FrozenRunTarget[],
  ): Promise<RunTargetPresentation[]>;
  delete(projectId: string): Promise<void>;
}

export type CreateProjectServiceOptions = {
  db: SurveyDatabase;
};

type LoadedProject = {
  project: ProjectRecord;
  revision: SourceRevisionRecord;
  form: Record<string, unknown>;
};

const parseForm = (schemaJson: string): Record<string, unknown> => {
  const parsed = JSON.parse(schemaJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw backendFailure("INTERNAL", "Stored Google Form snapshot is invalid");
  }
  return parsed as Record<string, unknown>;
};

const questionCount = (form: Record<string, unknown>): number =>
  Array.isArray(form.questions) ? form.questions.length : 0;

const loadProject = (db: SurveyDatabase, project: ProjectRecord): LoadedProject | null => {
  const revisionId = project.currentSourceRevisionId;
  if (!revisionId) return null;
  const revision = getSourceRevision(db, revisionId);
  if (!revision) throw backendFailure("INTERNAL", "Project source revision is missing");
  const snapshot = db
    .select()
    .from(formSnapshots)
    .where(eq(formSnapshots.id, revision.formSnapshotId))
    .get();
  if (!snapshot) throw backendFailure("INTERNAL", "Project Form snapshot is missing");
  return { project, revision, form: parseForm(snapshot.schemaJson) };
};

const summary = ({ project, revision, form }: LoadedProject): ProjectSummaryView => {
  if (!project.googleAccountId) {
    throw backendFailure("REAUTH_REQUIRED", "The Google account for this project is disconnected");
  }
  return {
    id: project.id,
    googleAccountId: project.googleAccountId as GoogleAccountId,
    googleFormId: project.googleFormId as FormId,
    name: project.name,
    currentSourceRevisionId: revision.id,
    createdAt: new Date(project.createdAtMs).toISOString(),
    updatedAt: new Date(project.updatedAtMs).toISOString(),
    responseCount: revision.responseCount,
    questionCount: questionCount(form),
  };
};

const responseTimestampRange = (
  db: SurveyDatabase,
  revisionId: string,
): { start: string; end: string } | null => {
  const responses = listSourceResponses(db, revisionId);
  if (responses.length === 0) return null;
  return {
    start: new Date(responses[0]!.submittedAtMs).toISOString(),
    end: new Date(responses[responses.length - 1]!.submittedAtMs).toISOString(),
  };
};

export const createProjectService = ({ db }: CreateProjectServiceOptions): ProjectService => ({
  list: async () => {
    const summaries = listProjects(db).flatMap((project) => {
      const loaded = loadProject(db, project);
      return loaded ? [summary(loaded)] : [];
    });
    const activeAccountId = getActiveGoogleAccountId(db);
    if (!activeAccountId) return summaries;
    const recentRank = new Map(
      getRecentProjectIds(db, activeAccountId).map(
        (projectId, index) => [projectId, index] as const,
      ),
    );
    return summaries.sort(
      (left, right) =>
        (recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  },

  get: async (projectId) => {
    const project = getProject(db, projectId);
    if (!project) return null;
    const loaded = loadProject(db, project);
    if (!loaded) return null;
    return {
      ...summary(loaded),
      form: loaded.form,
      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),
    };
  },

  open: async (projectId) => {
    const project = getProject(db, projectId);
    if (!project) return null;
    const loaded = loadProject(db, project);
    if (!loaded) return null;
    if (project.googleAccountId) recordRecentProject(db, project.googleAccountId, project.id);
    return {
      ...summary(loaded),
      form: loaded.form,
      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),
    };
  },

  sourceReview: async (projectId) => invalidValueGroupIdsForCurrentSource(db, projectId),

  runTargetPresentations: async (projectId, sourceRevisionId, targets) => {
    const revision = getSourceRevision(db, sourceRevisionId);
    if (!revision || revision.projectId !== projectId) {
      throw backendFailure("INTERNAL", "Historical Run source revision is invalid");
    }
    const snapshot = db
      .select()
      .from(formSnapshots)
      .where(eq(formSnapshots.id, revision.formSnapshotId))
      .get();
    if (!snapshot) throw backendFailure("INTERNAL", "Historical Run Form snapshot is missing");
    return buildRunTargetPresentations(parseForm(snapshot.schemaJson), targets);
  },

  delete: async (projectId) => {
    const project = getProject(db, projectId);
    if (!project) throw backendFailure("NOT_FOUND", "Project was not found");
    db.delete(projects).where(eq(projects.id, projectId)).run();
    if (project.googleAccountId) removeRecentProject(db, project.googleAccountId, project.id);
  },
});
