import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { PythonEngine } from "../electron/main/compute/python-engine";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createSynthesisService } from "../electron/main/synthesis/service";
import { createValueGroupService } from "../electron/main/value-groups/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

const setup = (): { database: AppDatabase; workRoot: string } => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-target-service-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
  databases.push(database);
  const workRoot = join(directory, "jobs");

  upsertGoogleAccount(database.db, {
    id: "account-1",
    email: "user@example.com",
    nowMs: 1000,
  });

  const citySeoul = { state: "answered", value: { kind: "text", value: "서울" } };
  const cityBusan = { state: "answered", value: { kind: "text", value: "부산" } };
  const regionSeoul = {
    state: "answered",
    value: { kind: "single_choice", optionKey: "seoul", label: "서울" },
  };
  const regionBusan = {
    state: "answered",
    value: { kind: "single_choice", optionKey: "busan", label: "부산" },
  };
  const optionAB = {
    state: "answered",
    value: { kind: "multi_choice", optionKeys: ["A", "B"], labels: ["A", "B"] },
  };
  const optionB = {
    state: "answered",
    value: { kind: "multi_choice", optionKeys: ["B"], labels: ["B"] },
  };

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
          { id: "q-score", kind: "ordinal", min: 1, max: 5 },
          { id: "q-city", kind: "text" },
          {
            id: "q-region",
            kind: "single_choice",
            options: [
              { key: "seoul", label: "서울" },
              { key: "busan", label: "부산" },
              { key: "jeju", label: "제주" },
            ],
          },
          {
            id: "q-checkbox",
            kind: "multi_choice",
            options: [
              { key: "A", label: "A" },
              { key: "B", label: "B" },
            ],
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
            "q-score": { state: "answered", value: { kind: "ordinal", value: 4 } },
            "q-city": citySeoul,
            "q-region": regionSeoul,
            "q-checkbox": optionAB,
          },
          origin: "original",
          path: { questions: {}, confidence: "certain" },
        },
      },
      {
        responseId: "r2",
        submittedAtMs: 4000,
        response: {
          responseId: "r2",
          answers: {
            "q-score": { state: "answered", value: { kind: "ordinal", value: 5 } },
            "q-city": cityBusan,
            "q-region": regionBusan,
            "q-checkbox": optionB,
          },
          origin: "original",
          path: { questions: {}, confidence: "certain" },
        },
      },
    ],
  });

  return { database, workRoot };
};

const captureEngine = (onCapture: (job: Record<string, unknown>) => void): PythonEngine => ({
  selftest: async () => {
    throw new Error("unused");
  },
  synthesize: async (_operationId, jobPath) => {
    onCapture(JSON.parse(readFileSync(jobPath, "utf8")) as Record<string, unknown>);
    return {
      status: "infeasible",
      kind: "synthesize",
      sourceCount: 2,
      finalCount: 4,
      target: { kind: "mean", column: "target_score", value: 4.5 },
      shareTargets: [],
      conditionalShareTargets: [],
      issues: [{ code: "test_stop", message: "captured" }],
    };
  },
  cancel: () => false,
});

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("target synthesis service", () => {
  it("compiles a ValueGroup population and checkbox option with the public TargetId", async () => {
    const { database, workRoot } = setup();
    const group = await createValueGroupService(database.db).create({
      projectId: "project-1",
      questionId: "q-city",
      name: "서울",
      members: ["서울"],
    });

    let captured: Record<string, unknown> | null = null;
    const service = createSynthesisService({
      db: database.db,
      engine: captureEngine((job) => {
        captured = job;
      }),
      workRoot,
    });
    const result = await service.start({
      projectId: "project-1",
      finalCount: 4,
      targets: [
        { id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 4.5 },
        {
          id: "t-conditional" as never,
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: group.id },
          questionId: "q-checkbox",
          optionKey: "A",
          value: 0.75,
        },
      ],
      sourceScope: { kind: "all" },
      seed: 42,
      operationId: "target-compile-conditional",
    });

    expect(result).toEqual({
      status: "infeasible",
      issues: [
        {
          targetIds: ["t-mean", "t-conditional"],
          code: "target_conflict",
          message: "captured",
        },
      ],
    });
    const conditional = (captured!.conditional_share_targets as Array<Record<string, unknown>>)[0]!;
    expect(conditional).toMatchObject({
      id: "t-conditional",
      population_column: "q_0",
      option_column: "q_2",
      value: 0.75,
    });
  });

  it("compiles a direct single-choice option share without a ValueGroup", async () => {
    const { database, workRoot } = setup();
    let captured: Record<string, unknown> | null = null;
    const service = createSynthesisService({
      db: database.db,
      engine: captureEngine((job) => {
        captured = job;
      }),
      workRoot,
    });

    await service.start({
      projectId: "project-1",
      finalCount: 4,
      targets: [
        { id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 4.5 },
        {
          id: "t-seoul" as never,
          kind: "share",
          subject: { kind: "option", questionId: "q-region", optionKey: "seoul" },
          value: 0.5,
        },
      ],
      sourceScope: { kind: "all" },
      seed: 42,
      operationId: "target-compile-option",
    });

    const share = (captured!.share_targets as Array<Record<string, unknown>>)[0]!;
    expect(share).toMatchObject({ id: "t-seoul", column: "q_1", value: 0.5 });
    expect(share.member_values).toEqual([
      JSON.stringify({
        state: "answered",
        value: { kind: "single_choice", optionKey: "seoul", label: "서울" },
      }),
    ]);
  });

  it("compiles an unconditional checkbox option share", async () => {
    const { database, workRoot } = setup();
    let captured: Record<string, unknown> | null = null;
    const service = createSynthesisService({
      db: database.db,
      engine: captureEngine((job) => {
        captured = job;
      }),
      workRoot,
    });

    await service.start({
      projectId: "project-1",
      finalCount: 4,
      targets: [
        { id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 4.5 },
        {
          id: "t-checkbox-a" as never,
          kind: "share",
          subject: { kind: "checkbox_option", questionId: "q-checkbox", optionKey: "A" },
          value: 0.5,
        },
      ],
      sourceScope: { kind: "all" },
      seed: 42,
      operationId: "target-compile-checkbox",
    });

    const share = (captured!.share_targets as Array<Record<string, unknown>>)[0]!;
    expect(share).toMatchObject({ id: "t-checkbox-a", column: "q_2", value: 0.5 });
  });

  it("keeps CountTarget in the public contract while reporting the Phase 2 execution boundary", async () => {
    const { database, workRoot } = setup();
    let engineCalled = false;
    const service = createSynthesisService({
      db: database.db,
      engine: captureEngine(() => {
        engineCalled = true;
      }),
      workRoot,
    });

    await expect(
      service.start({
        projectId: "project-1",
        finalCount: 4,
        targets: [
          { id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 4.5 },
          {
            id: "t-jeju-count" as never,
            kind: "count",
            subject: { kind: "option", questionId: "q-region", optionKey: "jeju" },
            value: 1,
          },
        ],
        sourceScope: { kind: "all" },
        seed: 42,
      }),
    ).resolves.toEqual({
      status: "infeasible",
      issues: [
        {
          targetIds: ["t-jeju-count"],
          code: "domain_unsupported",
          message:
            "Count targets are part of the public contract but are not executable by the current synthesis engine yet",
        },
      ],
    });
    expect(engineCalled).toBe(false);
  });
});
