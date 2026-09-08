import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import {
  createImportedProject,
  createSourceRevision,
  getRecentProjectIds,
  setActiveGoogleAccountId,
  upsertGoogleAccount,
} from "../electron/main/persistence/store";
import { createProjectService } from "../electron/main/projects/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const openDatabases: AppDatabase[] = [];
const tempDirectories: string[] = [];

const createDatabase = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-project-service-"));
  tempDirectories.push(directory);
  const database = openAppDatabase({
    filename: join(directory, "survey-synth.sqlite"),
    migrationsFolder,
  });
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
      schema: {
        title: "Event survey",
        questions: [
          {
            id: "q1",
            title: "Original choice",
            kind: "single_choice",
            options: [{ key: "a", label: "Original A" }],
          },
          { id: "q2", title: "Other", kind: "text" },
        ],
      },
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

  it("recomputes source review status from the current local revision", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    const service = createProjectService({ db: database.db });

    await expect(service.sourceReview("project-1")).resolves.toEqual({
      sourceRevisionId: "revision-1",
      invalidValueGroupIds: [],
    });
  });

  it("resolves historical target labels from the requested source revision after refresh", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    createSourceRevision(database.db, {
      projectId: "project-1",
      revisionId: "revision-2",
      importedAtMs: 5000,
      responseSetHash: "response-set-2",
      formSnapshot: {
        id: "snapshot-2",
        title: "Event survey",
        schemaHash: "schema-2",
        schema: {
          title: "Event survey",
          questions: [
            {
              id: "q1",
              title: "Updated choice",
              kind: "single_choice",
              options: [{ key: "a", label: "Updated A" }],
            },
          ],
        },
      },
      responses: [],
    });
    const service = createProjectService({ db: database.db });

    await expect(service.get("project-1")).resolves.toMatchObject({
      currentSourceRevisionId: "revision-2",
    });
    await expect(
      service.runTargetPresentations("project-1", "revision-1", [
        {
          id: "t-share" as never,
          kind: "share",
          value: 0.5,
          subject: { kind: "option", questionId: "q1", optionKey: "a" },
        },
      ]),
    ).resolves.toEqual([
      {
        targetId: "t-share",
        questionId: "q1",
        questionOrder: 0,
        questionTitle: "Original choice",
        subjectLabel: "Original A",
      },
    ]);
  });

  it("persists workspace recency and uses it for project ordering", async () => {
    const database = createDatabase();
    seedImportedProject(database);
    createImportedProject(database.db, {
      projectId: "project-2",
      revisionId: "revision-2",
      formSnapshotId: "snapshot-2",
      name: "Later survey",
      googleAccountId: "google-sub-1",
      googleFormId: "form-2",
      importedAtMs: 3000,
      responseSetHash: "response-set-2",
      formSnapshot: {
        title: "Later survey",
        schemaHash: "schema-2",
        capturedAtMs: 3000,
        schema: { title: "Later survey", questions: [] },
      },
      responses: [],
    });
    setActiveGoogleAccountId(database.db, "google-sub-1", 3500);
    const service = createProjectService({ db: database.db });

    await expect(service.list().then((items) => items.map((item) => item.id))).resolves.toEqual([
      "project-2",
      "project-1",
    ]);

    await expect(service.open("project-1")).resolves.toMatchObject({ id: "project-1" });
    expect(getRecentProjectIds(database.db, "google-sub-1")).toEqual(["project-1"]);
    await expect(service.get("project-2")).resolves.toMatchObject({ id: "project-2" });

    const recreatedService = createProjectService({ db: database.db });
    await expect(
      recreatedService.list().then((items) => items.map((item) => item.id)),
    ).resolves.toEqual(["project-1", "project-2"]);

    await recreatedService.delete("project-1");
    expect(getRecentProjectIds(database.db, "google-sub-1")).toEqual([]);
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
