import { randomUUID } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";

import type { SurveyDatabase } from "./database";
import {
  formSnapshots,
  projects,
  sourceResponses,
  sourceRevisions,
} from "./schema";

export type ProjectRecord = typeof projects.$inferSelect;
export type SourceRevisionRecord = typeof sourceRevisions.$inferSelect;

export type CreateProjectInput = {
  id?: string;
  name: string;
  googleAccountId?: string | null;
  googleFormId: string;
  nowMs?: number;
};

export const createProject = (db: SurveyDatabase, input: CreateProjectInput): ProjectRecord => {
  const nowMs = input.nowMs ?? Date.now();
  const row: typeof projects.$inferInsert = {
    id: input.id ?? randomUUID(),
    name: input.name,
    googleAccountId: input.googleAccountId ?? null,
    googleFormId: input.googleFormId,
    currentSourceRevisionId: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  db.insert(projects).values(row).run();
  return row as ProjectRecord;
};

export const getProject = (db: SurveyDatabase, projectId: string): ProjectRecord | null =>
  db.select().from(projects).where(eq(projects.id, projectId)).get() ?? null;

export const listProjects = (db: SurveyDatabase): ProjectRecord[] =>
  db.select().from(projects).orderBy(desc(projects.updatedAtMs)).all();

export type SourceResponseInput = {
  responseId: string;
  submittedAtMs: number;
  response: unknown;
};

export type CreateSourceRevisionInput = {
  projectId: string;
  formSnapshot: {
    id?: string;
    title: string;
    schema: unknown;
    schemaHash: string;
  };
  revisionId?: string;
  responseSetHash: string;
  responses: SourceResponseInput[];
  importedAtMs?: number;
};

export const createSourceRevision = (
  db: SurveyDatabase,
  input: CreateSourceRevisionInput,
): SourceRevisionRecord => {
  const project = getProject(db, input.projectId);
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  const importedAtMs = input.importedAtMs ?? Date.now();
  const formSnapshotId = input.formSnapshot.id ?? randomUUID();
  const revisionId = input.revisionId ?? randomUUID();

  const revision: typeof sourceRevisions.$inferInsert = {
    id: revisionId,
    projectId: project.id,
    formSnapshotId,
    responseCount: input.responses.length,
    responseSetHash: input.responseSetHash,
    importedAtMs,
  };

  db.transaction((tx) => {
    tx.insert(formSnapshots)
      .values({
        id: formSnapshotId,
        projectId: project.id,
        googleFormId: project.googleFormId,
        title: input.formSnapshot.title,
        schemaJson: JSON.stringify(input.formSnapshot.schema),
        schemaHash: input.formSnapshot.schemaHash,
        capturedAtMs: importedAtMs,
      })
      .run();

    tx.insert(sourceRevisions).values(revision).run();

    if (input.responses.length > 0) {
      tx.insert(sourceResponses)
        .values(
          input.responses.map((response) => ({
            revisionId,
            responseId: response.responseId,
            submittedAtMs: response.submittedAtMs,
            responseJson: JSON.stringify(response.response),
          })),
        )
        .run();
    }

    tx.update(projects)
      .set({ currentSourceRevisionId: revisionId, updatedAtMs: importedAtMs })
      .where(eq(projects.id, project.id))
      .run();
  });

  return revision as SourceRevisionRecord;
};

export const getSourceRevision = (
  db: SurveyDatabase,
  revisionId: string,
): SourceRevisionRecord | null =>
  db.select().from(sourceRevisions).where(eq(sourceRevisions.id, revisionId)).get() ?? null;

export type StoredSourceResponse = {
  responseId: string;
  submittedAtMs: number;
  response: unknown;
};

export const listSourceResponses = (
  db: SurveyDatabase,
  revisionId: string,
): StoredSourceResponse[] =>
  db
    .select()
    .from(sourceResponses)
    .where(eq(sourceResponses.revisionId, revisionId))
    .orderBy(asc(sourceResponses.submittedAtMs), asc(sourceResponses.responseId))
    .all()
    .map((row) => ({
      responseId: row.responseId,
      submittedAtMs: row.submittedAtMs,
      response: JSON.parse(row.responseJson) as unknown,
    }));
