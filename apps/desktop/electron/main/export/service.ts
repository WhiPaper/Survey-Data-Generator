import { eq } from "drizzle-orm";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { getRunRecord, listPersistedRunRows } from "../persistence/run-store";
import { formSnapshots, sourceRevisions } from "../persistence/schema";
import { listSourceResponses } from "../persistence/store";
import { writeCsv } from "./csv";
import {
  buildLogicalExportTable,
  type LogicalExportTable,
  type PersistedExportRow,
} from "./logical-table";
import { writeXlsx } from "./xlsx";

export type RunExportFormat = "csv" | "xlsx";
export type RunExportDataset = "run_scope" | "full_source_revision";

export type RunExportService = {
  buildTable: (runId: string, dataset?: RunExportDataset) => LogicalExportTable;
  exportTo: (
    runId: string,
    format: RunExportFormat,
    destination: string,
    dataset?: RunExportDataset,
  ) => Promise<void>;
};

export const createRunExportService = (db: SurveyDatabase): RunExportService => {
  const buildTable = (
    runId: string,
    dataset: RunExportDataset = "run_scope",
  ): LogicalExportTable => {
    const run = getRunRecord(db, runId);
    if (!run) throw backendFailure("NOT_FOUND", "Run not found");

    const revision = db
      .select({ formSnapshotId: sourceRevisions.formSnapshotId })
      .from(sourceRevisions)
      .where(eq(sourceRevisions.id, run.sourceRevisionId))
      .get();
    if (!revision) {
      throw backendFailure("INTERNAL", "Run source revision is missing");
    }

    const snapshot = db
      .select({ schemaJson: formSnapshots.schemaJson })
      .from(formSnapshots)
      .where(eq(formSnapshots.id, revision.formSnapshotId))
      .get();
    if (!snapshot) {
      throw backendFailure("INTERNAL", "Run Form snapshot is missing");
    }

    const form = JSON.parse(snapshot.schemaJson) as FormSnapshot;
    const runRows = listPersistedRunRows(db, runId);
    if (dataset === "run_scope" || run.scopeKind === "all") {
      return buildLogicalExportTable(form, runRows);
    }

    if (
      run.scopeKind !== "submitted_between" ||
      run.scopeStartMs === null ||
      run.scopeEndMs === null
    ) {
      throw backendFailure("INTERNAL", "Run source scope is incomplete");
    }

    const untouchedRows: PersistedExportRow[] = listSourceResponses(db, run.sourceRevisionId)
      .filter(
        (row) => row.submittedAtMs < run.scopeStartMs! || row.submittedAtMs > run.scopeEndMs!,
      )
      .map((row) => ({
        responseId: row.responseId,
        submittedAtMs: row.submittedAtMs,
        response: row.response as NormalizedResponse,
      }));

    return buildLogicalExportTable(form, [...untouchedRows, ...runRows]);
  };

  return {
    buildTable,
    async exportTo(runId, format, destination, dataset = "run_scope") {
      const table = buildTable(runId, dataset);
      if (format === "csv") await writeCsv(table, destination);
      else await writeXlsx(table, destination);
    },
  };
};
