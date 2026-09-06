import { eq } from "drizzle-orm";

import type { FormSnapshot } from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { getRunRecord, listPersistedRunRows } from "../persistence/run-store";
import { formSnapshots, sourceRevisions } from "../persistence/schema";
import { writeCsv } from "./csv";
import { buildLogicalExportTable, type LogicalExportTable } from "./logical-table";
import { writeXlsx } from "./xlsx";

export type RunExportFormat = "csv" | "xlsx";

export type RunExportService = {
  buildTable: (runId: string) => LogicalExportTable;
  exportTo: (runId: string, format: RunExportFormat, destination: string) => Promise<void>;
};

export const createRunExportService = (db: SurveyDatabase): RunExportService => {
  const buildTable = (runId: string): LogicalExportTable => {
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
    const rows = listPersistedRunRows(db, runId);
    return buildLogicalExportTable(form, rows);
  };

  return {
    buildTable,
    async exportTo(runId, format, destination) {
      const table = buildTable(runId);
      if (format === "csv") await writeCsv(table, destination);
      else await writeXlsx(table, destination);
    },
  };
};
