import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { createCompositeService } from "../electron/main/composites/service";
import { createImportedProject } from "../electron/main/persistence/store";
import type { SynthesisService } from "../electron/main/synthesis/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

const databaseWithResponses = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-composite-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
  databases.push(database);
  createImportedProject(database.db, {
    projectId: "project",
    revisionId: "revision",
    formSnapshotId: "form-snapshot",
    name: "Survey",
    googleFormId: "form",
    responseSetHash: "revision-hash",
    importedAtMs: 1,
    formSnapshot: {
      title: "Survey",
      schemaHash: "form-hash",
      capturedAtMs: 1,
      schema: { formId: "form", questions: [] },
    },
    responses: ["a", "b"].map((responseId, index) => ({
      responseId,
      submittedAtMs: 1000 + index * 1000,
      response: {
        responseId,
        answers: {},
        origin: "original",
        path: { questions: {}, confidence: "certain" },
      },
    })),
  });
  return database;
};

const unusedSynthesis: SynthesisService = {
  start: async () => {
    throw new Error("overlap must be checked before synthesis");
  },
  resolveEditPlan: async () => {
    throw new Error("unused");
  },
  cancel: () => false,
  getRun: async () => {
    throw new Error("unused");
  },
};

describe("composite batch validation", () => {
  it("autosaves an editable multi-rule draft independently from immutable results", async () => {
    const service = createCompositeService(databaseWithResponses().db, unusedSynthesis);
    await service.saveDraft({
      projectId: "project",
      rules: [
        {
          ruleId: "august",
          draft: {
            projectId: "project",
            finalCount: 3,
            sourceScope: { kind: "all" },
            seed: 1,
            targets: [],
          },
          count: { kind: "add", value: 1 },
        },
      ],
    });
    await expect(service.getDraft("project")).resolves.toMatchObject({
      projectId: "project",
      rules: [{ ruleId: "august", count: { kind: "add", value: 1 } }],
    });
  });

  it("rejects actual overlapping source response membership before starting a child Run", async () => {
    const service = createCompositeService(databaseWithResponses().db, unusedSynthesis);
    const result = await service.start({
      projectId: "project",
      overlapPolicy: "reject",
      rules: [
        {
          ruleId: "all",
          sourceScope: { kind: "all" },
          count: { kind: "add", value: 1 },
          targets: [],
          seed: 1,
        },
        {
          ruleId: "boundary",
          sourceScope: {
            kind: "submitted_between",
            start: new Date(1000).toISOString(),
            end: new Date(1000).toISOString(),
          },
          count: { kind: "add", value: 1 },
          targets: [],
          seed: 2,
        },
      ],
    });
    expect(result).toMatchObject({ status: "infeasible" });
    if (result.status === "infeasible")
      expect(result.issues[0]?.message).toContain("all and boundary overlap");
  });
});
