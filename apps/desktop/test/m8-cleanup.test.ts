import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { PythonEngine } from "../electron/main/compute/python-engine";
import { backendFailure } from "../electron/main/errors";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { runs } from "../electron/main/persistence/schema";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createSynthesisService } from "../electron/main/synthesis/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

const setup = (): { database: AppDatabase; workRoot: string } => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-m8-cleanup-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
  databases.push(database);
  upsertGoogleAccount(database.db, { id: "account-1", email: "user@example.com", nowMs: 1 });
  createImportedProject(database.db, {
    projectId: "project-1",
    revisionId: "revision-1",
    formSnapshotId: "snapshot-1",
    name: "Survey",
    googleAccountId: "account-1",
    googleFormId: "form-1",
    importedAtMs: 2,
    responseSetHash: "hash-1",
    formSnapshot: {
      title: "Survey",
      schemaHash: "schema-1",
      capturedAtMs: 2,
      schema: {
        formId: "form-1",
        title: "Survey",
        capturedAt: new Date(2).toISOString(),
        schemaHash: "schema-1",
        sections: [{ id: "section-1", title: "Main", order: 0, questionIds: ["q-score"] }],
        questions: [{
          id: "q-score",
          title: "Score",
          sectionId: "section-1",
          required: true,
          affectsNavigation: false,
          kind: "ordinal",
          presentation: "linear_scale",
          min: 1,
          max: 5,
        }],
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
    responses: [{
      responseId: "source-1",
      submittedAtMs: 3,
      response: {
        responseId: "source-1",
        answers: { "q-score": { state: "answered", value: { kind: "ordinal", value: 4 } } },
        origin: "original",
        path: { questions: { "q-score": "reached" }, confidence: "certain" },
      },
    }],
  });
  return { database, workRoot: join(directory, "jobs") };
};

const start = (database: AppDatabase, workRoot: string, engine: PythonEngine, operationId: string) =>
  createSynthesisService({ db: database.db, engine, workRoot }).start({
    projectId: "project-1",
    finalCount: 2,
    targets: [{ kind: "mean", questionId: "q-score", value: 4 }],
    sourceScope: { kind: "all" },
    seed: 8,
    operationId,
  });

const unusedSelftest: PythonEngine["selftest"] = async () => {
  throw new Error("unused");
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("M8 synthesis cleanup", () => {
  it("removes partial work files when the engine fails", async () => {
    const { database, workRoot } = setup();
    const operationId = "m8-engine-failure";
    const engine: PythonEngine = {
      selftest: unusedSelftest,
      synthesize: async (_id, jobPath) => {
        const workDir = dirname(jobPath);
        writeFileSync(join(workDir, "result.parquet"), "partial");
        writeFileSync(join(workDir, "report.json"), "partial");
        throw backendFailure("INTERNAL", "fixture engine failure");
      },
      cancel: () => false,
    };

    await expect(start(database, workRoot, engine, operationId)).rejects.toMatchObject({
      backendError: { code: "INTERNAL" },
    });
    expect(existsSync(join(workRoot, operationId))).toBe(false);
    expect(database.db.select().from(runs).all()).toHaveLength(0);
  });

  it("removes partial work files after cancellation", async () => {
    const { database, workRoot } = setup();
    const operationId = "m8-cancel";
    let rejectPending: ((reason: unknown) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const engine: PythonEngine = {
      selftest: unusedSelftest,
      synthesize: async (_id, jobPath) => {
        const workDir = dirname(jobPath);
        writeFileSync(join(workDir, "result.parquet"), "partial");
        writeFileSync(join(workDir, "report.json"), "partial");
        markStarted?.();
        return await new Promise<never>((_resolve, reject) => { rejectPending = reject; });
      },
      cancel: () => {
        rejectPending?.(backendFailure("JOB_CANCELLED", "fixture cancellation"));
        return true;
      },
    };
    const service = createSynthesisService({ db: database.db, engine, workRoot });
    const pending = service.start({
      projectId: "project-1",
      finalCount: 2,
      targets: [{ kind: "mean", questionId: "q-score", value: 4 }],
      sourceScope: { kind: "all" },
      seed: 8,
      operationId,
    });

    await started;
    expect(service.cancel(operationId)).toBe(true);
    await expect(pending).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
    expect(existsSync(join(workRoot, operationId))).toBe(false);
    expect(database.db.select().from(runs).all()).toHaveLength(0);
  });
});
