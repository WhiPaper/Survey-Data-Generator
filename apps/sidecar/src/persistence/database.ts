import { copyFile, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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
      await opened.backupBeforeMigration(existing);
      opened.migrate();
      if (stored === null) await secrets.set(DB_KEY_NAME, key);
      return opened;
    } catch (_error) {
      if (db?.open) db.close();
      throw sidecarError(
        "BACKEND_UNAVAILABLE",
        "Project database could not be opened safely",
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

  public checkpoint(): void {
    if (this.db.open) this.db.pragma("wal_checkpoint(FULL)");
  }

  private async backupBeforeMigration(existing: boolean): Promise<void> {
    const current = Number(this.db.pragma("user_version", { simple: true }));
    if (!existing || current >= VERSIONS.databaseSchemaVersion) return;
    // This is an encrypted byte-for-byte recovery copy. Checkpoint first so a
    // later migration failure never leaves recovery dependent on a WAL file.
    this.db.pragma("wal_checkpoint(FULL)");
    const backupDirectory = join(dirname(this.path), "migration-backups");
    mkdirSync(backupDirectory, { recursive: true });
    const backupPath = join(
      backupDirectory,
      `projects-v${current}-to-v${VERSIONS.databaseSchemaVersion}-${randomUUID()}.db`,
    );
    await new Promise<void>((resolve, reject) => {
      copyFile(this.path, backupPath, (error) => (error === null ? resolve() : reject(error)));
    });
  }

  private hasColumn(table: string, column: string): boolean {
    return this.db
      .prepare<{ name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .some((entry) => entry.name === column);
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
    if (current < 3) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS target_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS synthesis_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_revision_id TEXT NOT NULL REFERENCES source_revisions(id), target_snapshot_id TEXT NOT NULL REFERENCES target_snapshots(id), seed INTEGER NOT NULL, engine_version INTEGER NOT NULL, profiler_version INTEGER NOT NULL, created_at TEXT NOT NULL, validation_json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS synthetic_responses (run_id TEXT NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE, response_id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(run_id, response_id));
          CREATE INDEX IF NOT EXISTS idx_synthesis_runs_project_created ON synthesis_runs(project_id, created_at DESC);
          PRAGMA user_version = 3;
        `);
      });
    }
    if (current < 4) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS target_revisions (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id, revision));
          PRAGMA user_version = 4;
        `);
      });
      current = 4;
    }
    if (current < 5) {
      this.transaction(() => {
        if (!this.hasColumn("synthesis_runs", "target_revision"))
          this.db.exec(
            "ALTER TABLE synthesis_runs ADD COLUMN target_revision INTEGER NOT NULL DEFAULT 0",
          );
        this.db.pragma("user_version = 5");
      });
      current = 5;
    }
    if (current < 6) {
      this.transaction(() => {
        if (!this.hasColumn("synthesis_runs", "app_version"))
          this.db.exec(
            "ALTER TABLE synthesis_runs ADD COLUMN app_version TEXT NOT NULL DEFAULT ''",
          );
        if (!this.hasColumn("responses", "path_json"))
          this.db.exec("ALTER TABLE responses ADD COLUMN path_json TEXT NOT NULL DEFAULT '{}'");
        this.db.pragma("user_version = 6");
      });
      current = 6;
    }
    if (current < 7) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS response_versions (
            id TEXT PRIMARY KEY,
            response_id TEXT NOT NULL,
            created_at TEXT,
            last_submitted_at TEXT,
            content_hash TEXT NOT NULL,
            origin TEXT NOT NULL CHECK(origin = 'original'),
            path_json TEXT NOT NULL DEFAULT '{}'
          );
          CREATE TABLE IF NOT EXISTS response_version_answers (
            version_id TEXT NOT NULL REFERENCES response_versions(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL,
            slot_json TEXT NOT NULL,
            PRIMARY KEY(version_id, question_id)
          );
          CREATE TABLE IF NOT EXISTS revision_response_versions (
            revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE,
            response_version_id TEXT NOT NULL REFERENCES response_versions(id),
            PRIMARY KEY(revision_id, response_version_id)
          );
          CREATE TABLE IF NOT EXISTS target_migration_issues (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            source_revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE,
            issue_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(project_id, source_revision_id, issue_id)
          );
          CREATE TABLE IF NOT EXISTS semantic_overrides (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL,
            semantic_type TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, question_id)
          );
          CREATE INDEX IF NOT EXISTS idx_response_versions_lookup ON response_versions(response_id, content_hash);
          CREATE INDEX IF NOT EXISTS idx_revision_response_versions_rev ON revision_response_versions(revision_id);
          CREATE INDEX IF NOT EXISTS idx_target_migration_issues_proj ON target_migration_issues(project_id, source_revision_id);

          INSERT OR IGNORE INTO response_versions (id, response_id, created_at, last_submitted_at, content_hash, origin, path_json)
          SELECT id || ':' || content_hash, id, created_at, last_submitted_at, content_hash, origin, path_json FROM responses;

          INSERT OR IGNORE INTO response_version_answers (version_id, question_id, slot_json)
          SELECT r.id || ':' || r.content_hash, a.question_id, a.slot_json
          FROM answers a JOIN responses r ON r.id = a.response_id;

          INSERT OR IGNORE INTO revision_response_versions (revision_id, response_version_id)
          SELECT rr.revision_id, r.id || ':' || r.content_hash
          FROM revision_responses rr JOIN responses r ON r.id = rr.response_id;

          PRAGMA user_version = 7;
        `);
      });
      current = 7;
    }
    if (current < 8) {
      this.transaction(() => {
        if (!this.hasColumn("projects", "time_zone")) {
          this.db.exec("ALTER TABLE projects ADD COLUMN time_zone TEXT");
        }
        this.db.pragma("user_version = 8");
      });
      current = 8;
    }
    if (current < 9) {
      this.transaction(() => {
        if (!this.hasColumn("synthetic_responses", "synthetic_index")) {
          this.db.exec(
            "ALTER TABLE synthetic_responses ADD COLUMN synthetic_index INTEGER NOT NULL DEFAULT 0",
          );
          const runs = this.db
            .prepare<{ run_id: string }>("SELECT DISTINCT run_id FROM synthetic_responses")
            .all();
          const rows = this.db.prepare<{ response_id: string }>(
            "SELECT response_id FROM synthetic_responses WHERE run_id=? ORDER BY rowid ASC",
          );
          const update = this.db.prepare(
            "UPDATE synthetic_responses SET synthetic_index=? WHERE run_id=? AND response_id=?",
          );
          for (const run of runs) {
            rows.all(run.run_id).forEach((row, index) => {
              update.run(index, run.run_id, row.response_id);
            });
          }
        }
        if (!this.hasColumn("synthesis_runs", "semantic_overrides_json")) {
          this.db.exec("ALTER TABLE synthesis_runs ADD COLUMN semantic_overrides_json TEXT");
        }
        this.db.pragma("user_version = 9");
      });
      current = 9;
    }
    if (current < 10) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS run_ai_texts (
            run_id TEXT NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE,
            response_id TEXT NOT NULL,
            question_id TEXT NOT NULL,
            text TEXT NOT NULL,
            PRIMARY KEY(run_id, response_id, question_id)
          );
          CREATE TABLE IF NOT EXISTS run_ai_metadata (
            run_id TEXT PRIMARY KEY REFERENCES synthesis_runs(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_version INTEGER NOT NULL,
            settings_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            item_count INTEGER NOT NULL,
            generated_count INTEGER NOT NULL,
            failed_count INTEGER NOT NULL,
            generated_at TEXT NOT NULL,
            warnings_json TEXT NOT NULL DEFAULT '[]'
          );
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          PRAGMA user_version = 10;
        `);
      });
      current = 10;
    }
  }
}

export const defaultDatabasePath = (): string | null => {
  const root = process.env.SURVEY_SYNTH_APP_DATA_DIR;
  return root === undefined ? null : join(root, "projects.db");
};
