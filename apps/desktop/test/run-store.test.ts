import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import {
  getRunRecord,
  listPersistedRunRows,
  persistRun,
} from "../electron/main/persistence/run-store";
import { createProject, createSourceRevision } from "../electron/main/persistence/store";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const directories: string[] = [];
const databases: AppDatabase[] = [];

const createDatabase = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-run-store-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "survey-synth.sqlite"), migrationsFolder });
  databases.push(database);
  return database;
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("synthesis run persistence", () => {
  it("persists a frozen Run target snapshot and final rows atomically", () => {
    const database = createDatabase();
    createProject(database.db, {
      id: "project-1",
      name: "Survey",
      googleFormId: "form-1",
      nowMs: 1000,
    });
    createSourceRevision(database.db, {
      projectId: "project-1",
      revisionId: "revision-1",
      importedAtMs: 2000,
      responseSetHash: "source-hash",
      formSnapshot: { id: "snapshot-1", title: "Survey", schema: {}, schemaHash: "schema-hash" },
      responses: [],
    });

    persistRun(database.db, {
      id: "run-1",
      projectId: "project-1",
      sourceRevisionId: "revision-1",
      scope: {
        kind: "submitted_between",
        startMs: 10,
        endMs: 20,
        responseCount: 1,
        responseSetHash: "scope-hash",
      },
      finalResponseCount: 1,
      target: {
        finalCount: 1,
        sourceScope: {
          kind: "submitted_between",
          start: new Date(10).toISOString(),
          end: new Date(20).toISOString(),
        },
        targets: [
          { kind: "mean", questionId: "q-score", value: 4.7 },
          {
            kind: "share",
            value: 0.35,
            valueGroup: {
              id: "group-1",
              questionId: "q-choice",
              name: "행사 관심",
              members: ["festival"],
            },
          },
          {
            kind: "conditional_share",
            value: 0.6,
            valueGroup: {
              id: "group-1",
              questionId: "q-choice",
              name: "행사 관심",
              members: ["festival"],
            },
            questionId: "q-checkbox",
            optionKey: "music",
          },
        ],
      },
      seed: 42,
      engineReport: { status: "success", achieved: { mean: 4.7 } },
      rows: [
        {
          responseId: "synthetic:42:1",
          submittedAtMs: 15,
          origin: "synthetic",
          response: {
            responseId: "synthetic:42:1" as never,
            answers: {},
            origin: "synthetic",
            path: { questions: {}, confidence: "certain" },
          },
        },
      ],
      createdAtMs: 3000,
    });

    const stored = getRunRecord(database.db, "run-1");
    expect(stored).toMatchObject({
      id: "run-1",
      projectId: "project-1",
      sourceRevisionId: "revision-1",
      scopeKind: "submitted_between",
      scopeStartMs: 10,
      scopeEndMs: 20,
      scopeResponseCount: 1,
      scopeResponseSetHash: "scope-hash",
      finalResponseCount: 1,
      seed: 42,
      createdAtMs: 3000,
    });
    expect(JSON.parse(stored!.targetJson)).toMatchObject({
      targets: [
        { kind: "mean", questionId: "q-score", value: 4.7 },
        { kind: "share", valueGroup: { id: "group-1", members: ["festival"] } },
        {
          kind: "conditional_share",
          value: 0.6,
          valueGroup: { id: "group-1", members: ["festival"] },
          questionId: "q-checkbox",
          optionKey: "music",
        },
      ],
    });
    expect(listPersistedRunRows(database.db, "run-1")).toEqual([
      {
        responseId: "synthetic:42:1",
        submittedAtMs: 15,
        origin: "synthetic",
        response: {
          responseId: "synthetic:42:1",
          answers: {},
          origin: "synthetic",
          path: { questions: {}, confidence: "certain" },
        },
      },
    ]);
  });
});
