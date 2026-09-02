import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3-multiple-ciphers";

import { VERSIONS } from "@survey-synth/contracts";
import { sidecarError } from "../errors.js";
import type { SecureSecretStore } from "../host.js";

const DB_KEY_NAME = "survey-synth:database-key";

export class ProjectDatabase {
  public readonly path: string;
  private readonly db: Database;

  private constructor(path: string, db: Database) {
    this.path = path;
    this.db = db;
  }

  public static async open(path: string, secrets: SecureSecretStore): Promise<ProjectDatabase> {
    const existing = existsSync(path);
    const stored = await secrets.get(DB_KEY_NAME);
    if (stored === null && existing)
      throw sidecarError("BACKEND_UNAVAILABLE", "Project database key is unavailable", false);
    const key = stored ?? randomBytes(32);
    let db: Database | undefined;
    try {
      mkdirSync(dirname(path), { recursive: true });
      db = new Database(path);
      db.key(Buffer.from(key));
      db.pragma("cipher='sqlcipher'");
      db.pragma("foreign_keys = ON");
      db.pragma("secure_delete = ON");
      db.pragma("journal_mode = WAL");
      const opened = new ProjectDatabase(path, db);
      opened.migrate();
      if (stored === null) await secrets.set(DB_KEY_NAME, key);
      return opened;
    } catch (error) {
      if (db?.open) db.close();
      throw sidecarError(
        "BACKEND_UNAVAILABLE",
        `Project database could not be opened: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }
  }

  public transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  public prepare<Result = unknown>(sql: string) {
    return this.db.prepare<Result>(sql);
  }
  public close(): void {
    if (this.db.open) this.db.close();
  }

  private migrate(): void {
    let current = Number(this.db.pragma("user_version", { simple: true }));
    if (current > VERSIONS.databaseSchemaVersion)
      throw sidecarError(
        "BACKEND_UNAVAILABLE",
        "Project database is newer than this application",
        false,
      );
    if (current < 1) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, google_account_id TEXT NOT NULL, google_form_id TEXT NOT NULL, name TEXT NOT NULL, current_source_revision_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS form_snapshots (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, schema_hash TEXT NOT NULL, captured_at TEXT NOT NULL, payload_json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS source_revisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, form_snapshot_id TEXT NOT NULL REFERENCES form_snapshots(id), source_response_count INTEGER NOT NULL, response_set_hash TEXT NOT NULL, schema_hash TEXT NOT NULL, captured_at TEXT NOT NULL, imported_at TEXT NOT NULL, previous_revision_id TEXT REFERENCES source_revisions(id));
          CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, created_at TEXT, last_submitted_at TEXT, content_hash TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin = 'original'));
          CREATE TABLE IF NOT EXISTS revision_responses (revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE, response_id TEXT NOT NULL REFERENCES responses(id), PRIMARY KEY(revision_id, response_id));
          CREATE TABLE IF NOT EXISTS answers (response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE, question_id TEXT NOT NULL, slot_json TEXT NOT NULL, PRIMARY KEY(response_id, question_id));
          CREATE TABLE IF NOT EXISTS question_profiles (revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE, question_id TEXT NOT NULL, profiler_version INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(revision_id, question_id));
          CREATE TABLE IF NOT EXISTS relationship_profiles (revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE, question_a TEXT NOT NULL, question_b TEXT NOT NULL, profiler_version INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(revision_id, question_a, question_b));
          CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
          PRAGMA user_version = 2;
        `);
      });
      current = 2;
    }
    if (current < 2) {
      this.transaction(() => {
        this.db.exec(`
          ALTER TABLE responses ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
          PRAGMA user_version = 2;
        `);
      });
    }
  }
}

export const defaultDatabasePath = (): string | null => {
  const root = process.env.SURVEY_SYNTH_APP_DATA_DIR;
  return root === undefined ? null : join(root, "projects.db");
};
