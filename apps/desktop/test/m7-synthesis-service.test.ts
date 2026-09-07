import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parquetWriteFile } from "hyparquet-writer";
import { afterEach, describe, expect, it } from "vitest";

import type { PythonEngine } from "../electron/main/compute/python-engine";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { listPersistedRunRows } from "../electron/main/persistence/run-store";
import { runs } from "../electron/main/persistence/schema";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createSynthesisService } from "../electron/main/synthesis/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

const setup = (): { database: AppDatabase; workRoot: string } => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-m7-service-"));
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
        title: "Survey",
        capturedAt: new Date(2000).toISOString(),
        schemaHash: "schema-1",
        sections: [
          {
            id: "section-1",
            title: "Main",
            order: 0,
            questionIds: ["q-score"],
          },
        ],
        questions: [
          {
            id: "q-score",
            title: "Score",
            sectionId: "section-1",
            required: true,
            affectsNavigation: false,
            kind: "ordinal",
            presentation: "linear_scale",
            min: 1,
            max: 5,
          },
        ],
        groups: [],
        logic: {
          entrySectionId: "section-1",
          sections: [{ id: "section-1", order: 0, questionIds: ["q-score"] }],
          transitions: [],
          coverage: "none",
          hasRestartFlow: false,
        },
      },
    },
    responses: [
      {
        responseId: "source-1",
        submittedAtMs: 3000,
        response: {
          responseId: "source-1",
          answers: {
            "q-score": { state: "answered", value: { kind: "ordinal", value: 5 } },
          },
          origin: "original",
          path: { questions: { "q-score": "reached" }, confidence: "certain" },
        },
      },
      {
        responseId: "source-2",
        submittedAtMs: 4000,
        response: {
          responseId: "source-2",
          answers: {
            "q-score": { state: "answered", value: { kind: "ordinal", value: 5 } },
          },
          origin: "original",
          path: { questions: { "q-score": "reached" }, confidence: "certain" },
        },
      },
      {
        responseId: "source-3",
        submittedAtMs: 5000,
        response: {
          responseId: "source-3",
          answers: {
            "q-score": { state: "answered", value: { kind: "ordinal", value: 5 } },
          },
          origin: "original",
          path: { questions: { "q-score": "reached" }, confidence: "certain" },
        },
      },
    ],
  });

  return { database, workRoot: join(directory, "jobs") };
};

const writeResult = (
  path: string,
  rows: Array<{ responseId: string; submittedAt: string; score: number; origin: string }>,
): void => {
  parquetWriteFile({
    filename: path,
    columnData: [
      {
        name: "response_id",
        data: rows.map((row) => row.responseId),
        type: "STRING",
        nullable: false,
      },
      {
        name: "submitted_at",
        data: rows.map((row) => row.submittedAt),
        type: "STRING",
        nullable: false,
      },
      {
        name: "target_score_0",
        data: rows.map((row) => row.score),
        type: "DOUBLE",
        nullable: false,
      },
      {
        name: "__origin",
        data: rows.map((row) => row.origin),
        type: "STRING",
        nullable: false,
      },
    ],
  });
};

const replacementEngine = (): PythonEngine => ({
  selftest: async () => {
    throw new Error("unused");
  },
  synthesize: async (_operationId, jobPath) => {
    const workDir = dirname(jobPath);
    writeResult(join(workDir, "result.parquet"), [
      {
        responseId: "source-1",
        submittedAt: new Date(3000).toISOString(),
        score: 5,
        origin: "original",
      },
      {
        responseId: "source-2",
        submittedAt: new Date(4000).toISOString(),
        score: 5,
        origin: "original",
      },
      {
        responseId: "source-3",
        submittedAt: new Date(5000).toISOString(),
        score: 5,
        origin: "original",
      },
      {
        responseId: "synthetic:7:1",
        submittedAt: new Date(6000).toISOString(),
        score: 1,
        origin: "synthetic",
      },
    ]);
    writeResult(join(workDir, "result.replacement.parquet"), [
      {
        responseId: "source-1",
        submittedAt: new Date(3000).toISOString(),
        score: 5,
        origin: "original",
      },
      {
        responseId: "source-2",
        submittedAt: new Date(4000).toISOString(),
        score: 5,
        origin: "original",
      },
      {
        responseId: "replacement:7:1",
        submittedAt: new Date(5500).toISOString(),
        score: 1,
        origin: "synthetic",
      },
      {
        responseId: "synthetic:7:1",
        submittedAt: new Date(6000).toISOString(),
        score: 1,
        origin: "synthetic",
      },
    ]);
    return {
      status: "success",
      kind: "synthesize",
      sourceCount: 3,
      syntheticCount: 1,
      finalCount: 4,
      candidatePoolCount: 4,
      target: { kind: "mean", column: "target_score", value: 3, minimum: 1, maximum: 5 },
      shareTargets: [],
      conditionalShareTargets: [],
      achieved: {
        mean: 4,
        absoluteError: 1,
        exact: false,
        bestPossibleMean: 4,
        bestPossibleAbsoluteError: 1,
        shares: [],
        conditionalShares: [],
      },
      editPlan: {
        status: "available",
        replacementCount: 1,
        proposedReplacements: [
          { sourceResponseId: "source-3", replacementResponseId: "replacement:7:1" },
        ],
        appendOnlyOutcome: {
          mean: 4,
          absoluteError: 1,
          exact: false,
          shares: [],
          conditionalShares: [],
        },
        replacementOutcome: {
          mean: 3,
          absoluteError: 0,
          exact: true,
          shares: [],
          conditionalShares: [],
        },
      },
      validation: {
        finalCount: true,
        targetDomain: true,
        categoricalSupport: true,
        shareTargets: true,
        conditionalShareTargets: true,
        replacementApplied: false,
      },
      quality: { sdmetricsScore: null, warning: null },
      dependencies: {},
    };
  },
  cancel: () => false,
});

const startPendingPlan = async (database: AppDatabase, workRoot: string, operationId: string) => {
  const service = createSynthesisService({
    db: database.db,
    engine: replacementEngine(),
    workRoot,
  });
  const started = await service.start({
    projectId: "project-1",
    finalCount: 4,
    targets: [{ id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 3 }],
    targetIntents: [{ targetId: "t-mean" as never, intent: { kind: "absolute", value: 3 } }],
    sourceScope: { kind: "all" },
    seed: 7,
    operationId,
  });
  if (started.status !== "approval_required") throw new Error("expected approval_required");
  return { service, started };
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("M7 synthesis approval gate", () => {
  it("persists no Run until the user approves the replacement plan", async () => {
    const { database, workRoot } = setup();
    const { service, started } = await startPendingPlan(
      database,
      workRoot,
      "m7-replacement-approval",
    );

    expect(database.db.select().from(runs).all()).toHaveLength(0);
    expect(started.editPlan.replacementCount).toBe(1);
    expect(started.editPlan.appendOnlyOutcome.targets).toEqual([
      {
        targetId: "t-mean",
        kind: "mean",
        requested: 3,
        achieved: 4,
        absoluteError: 1,
        exact: false,
      },
    ]);
    expect(started.editPlan.replacementOutcome.targets[0]).toMatchObject({
      targetId: "t-mean",
      achieved: 3,
      exact: true,
    });

    const resolved = await service.resolveEditPlan({
      planId: started.planId,
      choice: "replacement",
    });
    expect(resolved.status).toBe("success");
    expect(database.db.select().from(runs).all()).toHaveLength(1);

    const run = await service.getRun(resolved.runId);
    expect(run.targetSnapshot.editPlan?.replacementCount).toBe(1);
    expect(run.targetSnapshot.targets[0]).toMatchObject({
      id: "t-mean",
      intent: { kind: "absolute", value: 3 },
    });
    expect(run.validation.achieved).toMatchObject({
      targets: [{ targetId: "t-mean", achieved: 3, absoluteError: 0, exact: true }],
    });
    expect(run.validation.validation).toMatchObject({
      replacementApplied: true,
      approvedReplacementCount: 1,
    });
    expect(run.diagnostics).toEqual({
      sourceResponseCount: 3,
      syntheticResponseCount: 2,
      replacementCount: 1,
      structuralValidation: "passed",
    });
    expect(run.baselines).toEqual([
      { targetId: "t-mean", kind: "mean", mean: 5, denominatorCount: 3 },
    ]);

    const rows = listPersistedRunRows(database.db, resolved.runId);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.origin === "original")).toHaveLength(2);
    expect(rows.some((row) => row.responseId === "source-3")).toBe(false);
    expect(rows.some((row) => row.responseId === "replacement:7:1")).toBe(true);
  });

  it("can keep the append-only result without freezing an unapproved EditPlan", async () => {
    const { database, workRoot } = setup();
    const { service, started } = await startPendingPlan(
      database,
      workRoot,
      "m7-append-only-choice",
    );

    const resolved = await service.resolveEditPlan({
      planId: started.planId,
      choice: "append_only",
    });
    const run = await service.getRun(resolved.runId);

    expect(run.targetSnapshot.editPlan).toBeUndefined();
    expect(run.validation.achieved).toMatchObject({
      targets: [{ targetId: "t-mean", achieved: 4, absoluteError: 1, exact: false }],
    });
    expect(run.validation.validation).toMatchObject({
      replacementApplied: false,
      approvedReplacementCount: 0,
    });
    expect(run.diagnostics).toEqual({
      sourceResponseCount: 3,
      syntheticResponseCount: 1,
      replacementCount: 0,
      structuralValidation: "passed",
    });
    expect(run.baselines).toEqual([
      { targetId: "t-mean", kind: "mean", mean: 5, denominatorCount: 3 },
    ]);

    const rows = listPersistedRunRows(database.db, resolved.runId);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.origin === "original")).toHaveLength(3);
    expect(rows.some((row) => row.responseId === "source-3")).toBe(true);
    expect(rows.some((row) => row.responseId.startsWith("replacement:"))).toBe(false);
  });
});
