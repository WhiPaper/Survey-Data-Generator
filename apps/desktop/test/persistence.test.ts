import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import {
  createProject,
  createSourceRevision,
  getProject,
  getSourceRevision,
  listProjects,
  listSourceResponses,
} from "../electron/main/persistence/store";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const versionsFile = fileURLToPath(new URL("../../../versions.json", import.meta.url"));

const tempDirectories: string[] = [];
const openDatabases: AppDatabase[] = [];

const createDatabase = (): { database: AppDatabase; filename: string } => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-v2-"));
  tempDirectories.push(directory);
  const filename = join(directory, "survey-synth.sqlite");
  const database = openAppDatabase({ filename, migrationsFolder });
  openDatabases.push(database);
  return { database, filename };
};

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database?.sqlite.open) database.close();
  }
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("v2 persistence", () => {
  it("tracks the ordered schema migrations", () => {
    const migrationFiles = readdirSync(migrationsFolder)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrationFiles).toEqual(["0001_initial.sql", "0002_target_drafts.sql"]);

    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toEqual([
      expect.objectContaining({
        idx: 0,
        tag: "0001_initial",
      }),
      expect.objectContaining({
        idx: 1,
        tag: "0002_target_drafts",
      }),
    ]);

    const versions = JSON.parse(readFileSync(versionsFile, "utf8")) as {
      databaseSchemaVersion: number;
    };
    expect(versions.databaseSchemaVersion).toBe(1);

    const { database } = createDatabase();
    const runColumns = database.sqlite.prepare("PRAGMA table_info('runs')").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(runColumns.find((column) => column.name === "app_version")).toMatchObject({
      notnull: 1,
      dflt_value: null,
    });
    expect(runColumns.find((column) => column.name === "engine_version")).toMatchObject({
      notnull: 1,
      dflt_value: null,
    });
  });

  it("creates a project and reopens it from the same sqlite file", () => {
    const { database, filename } = createDatabase();

    createProject(database.db, {
      id: "project-1",
      name: "Customer survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });

    expect(listProjects(database.db)).toHaveLength(1);
    database.close();

    const reopened = openAppDatabase({ filename, migrationsFolder });
    openDatabases.push(reopened);

    expect(getProject(reopened.db, "project-1")).toEqual({
      id: "project-1",
      name: "Customer survey",
      googleAccountId: null,
      googleFormId: "form-1",
      currentSourceRevisionId: null,
      createdAtMs: 1000,
      updatedAtMs: 1000,
    });
  });

  it("stores an immutable source revision and advances the project's current revision", () => {
    const { database } = createDatabase();

    createProject(database.db, {
      id: "project-1",
      name: "Customer survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });

    createSourceRevision(database.db, {
      revision: {
        id: "revision-1",
        projectId: "project-1",
        formSnapshotId: "form-snapshot-1",
        responseCount: 1,
        responseSetHash: "hash-1",
        importedAtMs: 2000,
      },
      formSnapshot: {
        id: "form-snapshot-1",
        projectId: "project-1",
        googleFormId: "form-1",
        title: "Customer survey",
        schema: { formId: "form-1", questions: [] },
        schemaHash: "schema-hash-1",
        capturedAtMs: 2000,
      },
      responses: [
        {
          responseId: "response-1",
          submittedAtMs: 1500,
          response: {
            responseId: "response-1",
            answers: {},
            origin: "original",
            path: { questions: {}, confidence: "certain" },
          },
        },
      ],
    });

    expect(getProject(database.db, "project-1")?.currentSourceRevisionId).toBe("revision-1");
    expect(getSourceRevision(database.db, "revision-1")).toMatchObject({
      id: "revision-1",
      responseSetHash: "hash-1",
      responseCount: 1,
    });
    expect(listSourceResponses(database.db, "revision-1")).toHaveLength(1);
  });

  it("rolls back the whole source revision when response ids are duplicated", () => {
    const { database } = createDatabase();

    createProject(database.db, {
      id: "project-1",
      name: "Customer survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });

    expect(() =>
      createSourceRevision(database.db, {
        revision: {
          id: "revision-1",
          projectId: "project-1",
          formSnapshotId: "form-snapshot-1",
          responseCount: 2,
          responseSetHash: "hash-1",
          importedAtMs: 2000,
        },
        formSnapshot: {
          id: "form-snapshot-1",
          projectId: "project-1",
          googleFormId: "form-1",
          title: "Customer survey",
          schema: { formId: "form-1", questions: [] },
          schemaHash: "schema-hash-1",
          capturedAtMs: 2000,
        },
        responses: [
          {
            responseId: "response-1",
            submittedAtMs: 1500,
            response: {
              responseId: "response-1",
              answers: {},
              origin: "original",
              path: { questions: {}, confidence: "certain" },
            },
          },
          {
            responseId: "response-1",
            submittedAtMs: 1600,
            response: {
              responseId: "response-1",
              answers: {},
              origin: "original",
              path: { questions: {}, confidence: "certain" },
            },
          },
        ],
      }),
    ).toThrow();

    expect(getProject(database.db, "project-1")?.currentSourceRevisionId).toBeNull();
    expect(getSourceRevision(database.db, "revision-1")).toBeUndefined();
  });
});
