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
const versionsFile = fileURLToPath(new URL("../../../versions.json", import.meta.url));

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
  it("starts from the single schema 0001 baseline", () => {
    const migrationFiles = readdirSync(migrationsFolder)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrationFiles).toEqual(["0001_initial.sql"]);

    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toEqual([
      expect.objectContaining({
        idx: 0,
        tag: "0001_initial",
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
      name: "Event survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });

    const revision = createSourceRevision(database.db, {
      projectId: "project-1",
      revisionId: "revision-1",
      importedAtMs: 2000,
      responseSetHash: "responses-hash-1",
      formSnapshot: {
        id: "form-snapshot-1",
        title: "Event survey",
        schema: { questions: [{ id: "q1", type: "choice" }] },
        schemaHash: "schema-hash-1",
      },
      responses: [
        { responseId: "r2", submittedAtMs: 2200, response: { q1: "B" } },
        { responseId: "r1", submittedAtMs: 2100, response: { q1: "A" } },
      ],
    });

    expect(revision.responseCount).toBe(2);
    expect(getSourceRevision(database.db, "revision-1")).toEqual(revision);
    expect(getProject(database.db, "project-1")?.currentSourceRevisionId).toBe("revision-1");
    expect(listSourceResponses(database.db, "revision-1")).toEqual([
      { responseId: "r1", submittedAtMs: 2100, response: { q1: "A" } },
      { responseId: "r2", submittedAtMs: 2200, response: { q1: "B" } },
    ]);
  });

  it("rolls back the whole source revision when response ids are duplicated", () => {
    const { database } = createDatabase();

    createProject(database.db, {
      id: "project-1",
      name: "Event survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });

    expect(() =>
      createSourceRevision(database.db, {
        projectId: "project-1",
        revisionId: "revision-bad",
        importedAtMs: 2000,
        responseSetHash: "responses-hash-bad",
        formSnapshot: {
          id: "form-snapshot-bad",
          title: "Event survey",
          schema: {},
          schemaHash: "schema-hash-bad",
        },
        responses: [
          { responseId: "duplicate", submittedAtMs: 2100, response: { q1: "A" } },
          { responseId: "duplicate", submittedAtMs: 2200, response: { q1: "B" } },
        ],
      }),
    ).toThrow();

    expect(getSourceRevision(database.db, "revision-bad")).toBeNull();
    expect(getProject(database.db, "project-1")?.currentSourceRevisionId).toBeNull();
  });
});
