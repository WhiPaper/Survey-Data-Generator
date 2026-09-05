import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createValueGroupService } from "../electron/main/value-groups/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

const setup = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-value-group-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
  databases.push(database);

  upsertGoogleAccount(database.db, {
    id: "account-1",
    email: "user@example.com",
    nowMs: 1000,
  });
  createImportedProject(database.db, {
    projectId: "project-1",
    revisionId: "revision-1",
    formSnapshotId: "snapshot-1",
    name: "Survey",
    googleAccountId: "account-1",
    googleFormId: "form-1",
    importedAtMs: 2000,
    responseSetHash: "hash-1",
    formSnapshot: {
      title: "Survey",
      schemaHash: "schema-1",
      capturedAtMs: 2000,
      schema: {
        formId: "form-1",
        questions: [
          {
            id: "q-choice",
            kind: "single_choice",
            options: [
              { key: "festival", label: "축제" },
              { key: "performance", label: "공연" },
              { key: "family", label: "가족 나들이" },
            ],
          },
          {
            id: "q-text",
            kind: "text",
            presentation: "short",
          },
        ],
      },
    },
    responses: [
      {
        responseId: "r1",
        submittedAtMs: 3000,
        response: {
          responseId: "r1",
          answers: {
            "q-choice": {
              state: "answered",
              value: { kind: "single_choice", optionKey: "festival", label: "축제" },
            },
            "q-text": {
              state: "answered",
              value: { kind: "text", value: "야간축제" },
            },
          },
          origin: "original",
          path: {
            questions: { "q-choice": "reached", "q-text": "reached" },
            confidence: "certain",
          },
        },
      },
      {
        responseId: "r2",
        submittedAtMs: 4000,
        response: {
          responseId: "r2",
          answers: {
            "q-choice": {
              state: "answered",
              value: { kind: "single_choice", optionKey: "family", label: "가족 나들이" },
            },
            "q-text": {
              state: "answered",
              value: { kind: "text", value: "불꽃놀이" },
            },
          },
          origin: "original",
          path: {
            questions: { "q-choice": "reached", "q-text": "reached" },
            confidence: "certain",
          },
        },
      },
      {
        responseId: "r3",
        submittedAtMs: 5000,
        response: {
          responseId: "r3",
          answers: {
            "q-choice": {
              state: "answered",
              value: { kind: "single_choice", optionKey: "festival", label: "축제" },
            },
            "q-text": {
              state: "answered",
              value: { kind: "text", value: "야간축제" },
            },
          },
          origin: "original",
          path: {
            questions: { "q-choice": "reached", "q-text": "reached" },
            confidence: "certain",
          },
        },
      },
    ],
  });
  return database;
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("ValueGroup service", () => {
  it("lists Form options with observed counts including zero-observed options", async () => {
    const service = createValueGroupService(setup().db);
    await expect(service.values("project-1", "q-choice")).resolves.toEqual([
      { value: "festival", label: "축제", count: 2 },
      { value: "performance", label: "공연", count: 0 },
      { value: "family", label: "가족 나들이", count: 1 },
    ]);
  });

  it("lists exact observed text values by frequency without semantic classification", async () => {
    const service = createValueGroupService(setup().db);
    await expect(service.values("project-1", "q-text")).resolves.toEqual([
      { value: "야간축제", label: "야간축제", count: 2 },
      { value: "불꽃놀이", label: "불꽃놀이", count: 1 },
    ]);
  });

  it("stores exactly the user-selected choice membership and deletes the group", async () => {
    const service = createValueGroupService(setup().db);
    const created = await service.create({
      projectId: "project-1",
      questionId: "q-choice",
      name: "행사 관심",
      members: ["festival", "performance"],
    });

    expect(created).toMatchObject({
      projectId: "project-1",
      questionId: "q-choice",
      name: "행사 관심",
      members: ["festival", "performance"],
    });
    await expect(service.list("project-1")).resolves.toEqual([created]);
    await expect(service.delete(created.id)).resolves.toBeUndefined();
    await expect(service.list("project-1")).resolves.toEqual([]);
  });

  it("stores exact observed text values as user-defined membership", async () => {
    const service = createValueGroupService(setup().db);
    const created = await service.create({
      projectId: "project-1",
      questionId: "q-text",
      name: "야간 행사 언급",
      members: ["야간축제", "불꽃놀이"],
    });

    expect(created).toMatchObject({
      questionId: "q-text",
      name: "야간 행사 언급",
      members: ["야간축제", "불꽃놀이"],
    });
  });
});