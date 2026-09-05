import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const googleAccounts = sqliteTable(
  "google_accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [uniqueIndex("google_accounts_email_unique").on(table.email)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    googleAccountId: text("google_account_id").references(() => googleAccounts.id, {
      onDelete: "set null",
    }),
    googleFormId: text("google_form_id").notNull(),
    currentSourceRevisionId: text("current_source_revision_id"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [index("projects_google_account_idx").on(table.googleAccountId)],
);

export const formSnapshots = sqliteTable(
  "form_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    googleFormId: text("google_form_id").notNull(),
    title: text("title").notNull(),
    schemaJson: text("schema_json").notNull(),
    schemaHash: text("schema_hash").notNull(),
    capturedAtMs: integer("captured_at_ms").notNull(),
  },
  (table) => [index("form_snapshots_project_idx").on(table.projectId)],
);

export const sourceRevisions = sqliteTable(
  "source_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formSnapshotId: text("form_snapshot_id")
      .notNull()
      .references(() => formSnapshots.id, { onDelete: "restrict" }),
    responseCount: integer("response_count").notNull(),
    responseSetHash: text("response_set_hash").notNull(),
    importedAtMs: integer("imported_at_ms").notNull(),
  },
  (table) => [
    index("source_revisions_project_idx").on(table.projectId),
    index("source_revisions_project_hash_idx").on(table.projectId, table.responseSetHash),
  ],
);

export const sourceResponses = sqliteTable(
  "source_responses",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => sourceRevisions.id, { onDelete: "cascade" }),
    responseId: text("response_id").notNull(),
    submittedAtMs: integer("submitted_at_ms").notNull(),
    responseJson: text("response_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.responseId] }),
    index("source_responses_revision_submitted_idx").on(table.revisionId, table.submittedAtMs),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => sourceRevisions.id, { onDelete: "restrict" }),
    scopeKind: text("scope_kind").notNull(),
    scopeStartMs: integer("scope_start_ms"),
    scopeEndMs: integer("scope_end_ms"),
    scopeResponseCount: integer("scope_response_count").notNull(),
    scopeResponseSetHash: text("scope_response_set_hash").notNull(),
    finalResponseCount: integer("final_response_count").notNull(),
    targetJson: text("target_json").notNull(),
    seed: integer("seed").notNull(),
    engineReportJson: text("engine_report_json").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    index("runs_project_idx").on(table.projectId),
    index("runs_source_revision_idx").on(table.sourceRevisionId),
  ],
);

export const runRows = sqliteTable(
  "run_rows",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    responseId: text("response_id").notNull(),
    submittedAtMs: integer("submitted_at_ms").notNull(),
    origin: text("origin").notNull(),
    responseJson: text("response_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.rowIndex] }),
    index("run_rows_run_idx").on(table.runId),
  ],
);

export const preferences = sqliteTable("preferences", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const persistenceSchema = {
  googleAccounts,
  projects,
  formSnapshots,
  sourceRevisions,
  sourceResponses,
  runs,
  runRows,
  preferences,
};
