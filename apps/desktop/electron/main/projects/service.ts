import type { ProjectDetailView, ProjectSummaryView } from "@survey-synth/contracts";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import {
  getFormSnapshot,
  getProject,
  getSourceRevision,
  listProjects,
  listSourceResponses,
  type ProjectRecord,
  type SourceRevisionRecord,
} from "../persistence/store";

export interface ProjectService {
  list(): Promise<ProjectSummaryView[]>;
  get(projectId: string): Promise<ProjectDetailView | null>;
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
  if (!revision) {
    throw backendFailure("INTERNAL", "Project source revision is missing");
  }
  const snapshot = getFormSnapshot(db, revision.formSnapshotId);
  if (!snapshot) {
    throw backendFailure("INTERNAL", "Project Form snapshot is missing");
  }
  return { project, revision, form: parseForm(snapshot.schemaJson) };
};

const summary = ({ project, revision, form }: LoadedProject): ProjectSummaryView => {
  if (!project.googleAccountId) {
    throw backendFailure("REAUTH_REQUIRED", "The Google account for this project is disconnected");
  }
  return {
    id: project.id,
    googleAccountId: project.googleAccountId,
    googleFormId: project.googleFormId,
    name: project.name,
    timeZone: null,
    currentSourceRevisionId: revision.id,
    createdAt: new Date(project.createdAtMs).toISOString(),
    updatedAt: new Date(project.updatedAtMs).toISOString(),
    responseCount: revision.responseCount,
    questionCount: questionCount(form),
    profileCount: 0,
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
  list: async () =>
    listProjects(db).flatMap((project) => {
      const loaded = loadProject(db, project);
      return loaded ? [summary(loaded)] : [];
    }),

  get: async (projectId) => {
    const project = getProject(db, projectId);
    if (!project) return null;
    const loaded = loadProject(db, project);
    if (!loaded) return null;
    const base = summary(loaded);
    return {
      ...base,
      form: loaded.form,
      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),
      targets: {
        targetResponseCount: loaded.revision.responseCount,
        questionTargets: [],
      },
      targetRevision: 0,
      profiles: [],
      relationships: [],
    };
  },
});
