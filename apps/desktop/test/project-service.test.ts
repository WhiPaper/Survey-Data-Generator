import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createProjectService } from "../electron/main/projects/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const openDatabases: AppDatabase[] = [];
const tempDirectories: string[] = [];

const createDatabase = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-project-service-"));
  tempDirectories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "survey-synth.sqlite"), migrationsFolder });
  openDatabases.push(database);
  return database;
};

const seedImportedProject = (database: AppDatabase): void => {
  upsertGoogleAccount(database.db, {
    id: "google-sub-1",
    email: "user@example.com",
    displayName: "User",
    nowMs: 1000,
  });
  createImportedProject(database.db, {
    projectId: "project-1",
    revisionId: "revision-1",
    formSnapshotId: "snapshot-1",
    name: "Event survey",
    googleAccountId: "google-sub-1",
    googleFormId: "form-1",
    importedAtMs: 2000,
    responseSetHash: "response-set-1",
    formSnapshot: {
      title: "Event survey",
      schemaHash: "schema-1",
      capturedAtMs: 2000,
      schema: { title: "Event survey", questions: [{ id: "q1" }, { id: "q2" }] },
    },
    responses: [
      { responseId: "r2", submittedAtMs: 4000, response: { answers: {} } },
      { responseId: "r1", submittedAtMs: 3000, response: { answers: {} } },
    ],
  });
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

describe("project service", () => {
  it("lists imported projects from persisted source revisions", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    const service = createProjectService({ db: database.db });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: "project-1",
        name: "Event survey",
        currentSourceRevisionId: "revision-1",
        responseCount: 2,
        questionCount: 2,
      }),
    ]);
  });

  it("reopens only the current Form snapshot and timestamp range", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    const service = createProjectService({ db: database.db });

    const detail = await service.get("project-1");
    expect(detail).toEqual(
      expect.objectContaining({
        id: "project-1",
        currentSourceRevisionId: "revision-1",
        form: expect.objectContaining({ title: "Event survey" }),
        responseTimestampRange: {
          start: new Date(3000).toISOString(),
          end: new Date(4000).toISOString(),
        },
      }),
    );
    expect(detail).not.toHaveProperty("profiles");
    expect(detail).not.toHaveProperty("relationships");
    expect(detail).not.toHaveProperty("targets");
  });

  it("deletes a project and its persisted source graph", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    const service = createProjectService({ db: database.db });

    await expect(service.delete("project-1")).resolves.toBeUndefined();
    await expect(service.get("project-1")).resolves.toBeNull();
    await expect(service.list()).resolves.toEqual([]);
  });

  it("returns not found when deleting an unknown project", async () => {
    const database = createDatabase();
    const service = createProjectService({ db: database.db });

    await expect(service.delete("missing-project")).rejects.toMatchObject({
      backendError: { code: "NOT_FOUND" },
    });
  });
});
