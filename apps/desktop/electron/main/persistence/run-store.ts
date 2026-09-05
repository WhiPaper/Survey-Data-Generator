import { asc, eq } from "drizzle-orm";

import type { NormalizedResponse } from "@survey-synth/domain";

import type { SurveyDatabase } from "./database";
import { runRows, runs } from "./schema";

export type RunRecord = typeof runs.$inferSelect;

export type PersistRunInput = {
  id: string;
  projectId: string;
  sourceRevisionId: string;
  scope: {
    kind: "all" | "submitted_between";
    startMs?: number;
    endMs?: number;
    responseCount: number;
    responseSetHash: string;
  };
  finalResponseCount: number;
  target: unknown;
  seed: number;
  engineReport: unknown;
  rows: readonly {
    responseId: string;
    submittedAtMs: number;
    origin: "original" | "synthetic";
    response: NormalizedResponse;
  }[];
  createdAtMs?: number;
};

export const persistRun = (db: SurveyDatabase, input: PersistRunInput): RunRecord => {
  const createdAtMs = input.createdAtMs ?? Date.now();
  const run: typeof runs.$inferInsert = {
    id: input.id,
    projectId: input.projectId,
    sourceRevisionId: input.sourceRevisionId,
    scopeKind: input.scope.kind,
    scopeStartMs: input.scope.startMs ?? null,
    scopeEndMs: input.scope.endMs ?? null,
    scopeResponseCount: input.scope.responseCount,
    scopeResponseSetHash: input.scope.responseSetHash,
    finalResponseCount: input.finalResponseCount,
    targetJson: JSON.stringify(input.target),
    seed: input.seed,
    engineReportJson: JSON.stringify(input.engineReport),
    createdAtMs,
  };

  db.transaction((tx) => {
    tx.insert(runs).values(run).run();
    if (input.rows.length > 0) {
      tx.insert(runRows)
        .values(
          input.rows.map((row, rowIndex) => ({
            runId: input.id,
            rowIndex,
            responseId: row.responseId,
            submittedAtMs: row.submittedAtMs,
            origin: row.origin,
            responseJson: JSON.stringify(row.response),
          })),
        )
        .run();
    }
  });

  return run as RunRecord;
};

export const getRunRecord = (db: SurveyDatabase, runId: string): RunRecord | null =>
  db.select().from(runs).where(eq(runs.id, runId)).get() ?? null;

export const listPersistedRunRows = (
  db: SurveyDatabase,
  runId: string,
): Array<{
  responseId: string;
  submittedAtMs: number;
  origin: "original" | "synthetic";
  response: NormalizedResponse;
}> =>
  db
    .select()
    .from(runRows)
    .where(eq(runRows.runId, runId))
    .orderBy(asc(runRows.rowIndex))
    .all()
    .map((row) => {
      if (row.origin !== "original" && row.origin !== "synthetic") {
        throw new Error(`Invalid persisted run row origin: ${row.origin}`);
      }
      return {
        responseId: row.responseId,
        submittedAtMs: row.submittedAtMs,
        origin: row.origin,
        response: JSON.parse(row.responseJson) as NormalizedResponse,
      };
    });
