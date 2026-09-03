import { describe, expect, it, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectDatabase } from "../src/persistence/database.js";
import { ProjectRepository } from "../src/persistence/projects.js";
import { ensureExportExtension, ExportService } from "../src/export/export-service.js";
import type { SecureSecretStore } from "../src/host.js";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import type { ValidationResult } from "@survey-synth/synthesis-core";

class TestSecrets implements SecureSecretStore {
  public readonly values = new Map<string, Uint8Array>();
  public get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  public set(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const makeMockForm = (): FormSnapshot => ({
  formId: "form_test" as never,
  title: "고객 조사",
  revision: 1,
  capturedAt: "2026-09-01T00:00:00Z",
  schemaHash: "hash123",
  groups: [],
  questions: [
    {
      id: "q_sat" as never,
      title: "만족도",
      kind: "ordinal",
      scale: { min: 1, max: 5 },
    },
  ],
});

const makeMockResponses = (count: number): NormalizedResponse[] =>
  Array.from({ length: count }, (_, i) => ({
    responseId: `orig_${i}` as never,
    createdAt: "2026-09-01T10:00:00Z",
    origin: "original" as const,
    answers: {
      q_sat: { state: "answered", value: { kind: "ordinal", value: 4 } },
    },
    path: { visitedQuestionIds: [], status: "complete" },
  }));

const makeMockValidation = (finalCount: number, valid = true): ValidationResult => ({
  valid,
  originalMutationCount: 0,
  finalResponseCount: finalCount,
  metrics: [],
  errors: [],
});

describe("ExportService", () => {
  let db: ProjectDatabase;
  let repo: ProjectRepository;
  let secrets: TestSecrets;
  let tempDir: string;
  const testFiles: string[] = [];

  const tempPath = (ext: "csv" | "xlsx"): string => {
    const path = resolve(tmpdir(), `export_svc_${randomUUID()}.${ext}`);
    testFiles.push(path);
    return path;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "export-svc-db-"));
    const dbPath = join(tempDir, "projects.db");
    secrets = new TestSecrets();
    db = await ProjectDatabase.open(dbPath, secrets);
    repo = new ProjectRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
    for (const f of testFiles) {
      try {
        await rm(f, { force: true });
        await rm(`${f}.tmp*`, { force: true });
      } catch {
        // ignore
      }
    }
    testFiles.length = 0;
  });

  it("keeps selected paths aligned with the writer format", () => {
    expect(ensureExportExtension("report", "csv")).toBe("report.csv");
    expect(ensureExportExtension("report.xlsx", "csv")).toBe("report.csv");
    expect(ensureExportExtension("report.csv", "xlsx")).toBe("report.xlsx");
    expect(ensureExportExtension("report.xlsx", "xlsx")).toBe("report.xlsx");
    expect(ensureExportExtension("report.csv.xlsx", "csv")).toBe("report.csv");
  });

  it("handles save dialog cancellation gracefully", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(5));

    const targets: ProjectTargets = {
      targetResponseCount: 10,
      questionTargets: [],
    };
    const syntheticResponses: NormalizedResponse[] = Array.from({ length: 5 }, (_, i) => ({
      responseId: `synth_${i}` as never,
      createdAt: "2026-09-01T11:00:00Z",
      origin: "synthetic" as const,
      answers: {
        q_sat: { state: "answered", value: { kind: "ordinal", value: 5 } },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets,
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(10, true),
      synthetic: syntheticResponses,
    });

    const mockHostClient = {
      call: async () => ({ path: null }),
    };

    const logs: Array<{ event: string; payload: unknown }> = [];
    const mockLogger = {
      info: (event: string, payload: unknown) => logs.push({ event, payload }),
      error: () => {},
      warn: () => {},
      debug: () => {},
    };

    const service = new ExportService({
      projects: repo,
      hostClient: mockHostClient as never,
      logger: mockLogger,
    });

    const result = await service.export({
      runId: run.id,
      format: "csv",
    });

    expect(result.ok).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.destination).toBeUndefined();
  });

  it("rejects unvalidated or invalid runs", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(5));

    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 10, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(5, true),
      synthetic: [],
    });
    // Invalidate the run in DB to test export rejection
    db.prepare("UPDATE synthesis_runs SET validation_json=? WHERE id=?").run(
      JSON.stringify({ valid: false }),
      run.id,
    );

    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });

    await expect(
      service.exportToFile({
        runId: run.id,
        format: "csv",
        destination: tempPath("csv"),
      }),
    ).rejects.toThrow("Invalid synthesis Run cannot be exported");
  });

  it("rejects a Run whose persisted synthetic rows are incomplete without replacing output", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(1));
    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 2, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(2, true),
      synthetic: [
        {
          responseId: "synth_1" as never,
          createdAt: "2026-09-01T11:00:00Z",
          origin: "synthetic",
          answers: {
            q_sat: { state: "answered", value: { kind: "ordinal", value: 5 } },
          },
          path: { visitedQuestionIds: [], status: "complete" },
        },
      ],
    });
    db.prepare("DELETE FROM synthetic_responses WHERE run_id=?").run(run.id);

    const destination = tempPath("csv");
    await writeFile(destination, "previous export", "utf8");
    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });

    await expect(
      service.exportToFile({ runId: run.id, format: "csv", destination }),
    ).rejects.toThrow("Persisted Run response count mismatch");
    expect(await readFile(destination, "utf8")).toBe("previous export");
  });

  it("uses a valid persisted timezone for a legacy project after restart", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport(
      "acc_1" as never,
      form,
      makeMockResponses(1),
      "imported",
      "America/New_York",
    );
    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 1, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(1, true),
      synthetic: [],
    });

    // Keep the valid persisted value while reopening through the pre-v8 marker.
    db.prepare("PRAGMA user_version = 7").run();
    db.close();
    db = await ProjectDatabase.open(join(tempDir, "projects.db"), secrets);
    repo = new ProjectRepository(db);

    const historical = repo.loadHistoricalRunExportData(run.id);
    expect(historical.timeZone).toBe("America/New_York");

    const destination = tempPath("csv");
    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });
    await service.exportToFile({ runId: run.id, format: "csv", destination });
    expect(await readFile(destination, "utf8")).toContain("2026-09-01T06:00:00-04:00");
  });

  it("does not invent a timezone for an unknown legacy project after restart", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(1));
    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 1, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(1, true),
      synthetic: [],
    });
    db.prepare("UPDATE projects SET time_zone=NULL WHERE id=?").run(created.project.id);
    db.close();
    db = await ProjectDatabase.open(join(tempDir, "projects.db"), secrets);
    repo = new ProjectRepository(db);

    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });
    await expect(
      service.exportToFile({ runId: run.id, format: "csv", destination: tempPath("csv") }),
    ).rejects.toMatchObject({
      backendError: {
        code: "LEGACY_COMPATIBILITY_REQUIRED",
        details: {
          kind: "legacy_compatibility_required",
          reason: "missing_project_timezone",
          supportedSinceDatabaseSchemaVersion: 8,
        },
      },
    });
  });

  it("does not use a current override when a legacy Run has no frozen snapshot", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(1));
    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 1, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(1, true),
      synthetic: [],
    });
    repo.setSemanticOverride(created.project.id, "q_sat" as never, "numeric");
    db.prepare("UPDATE synthesis_runs SET semantic_overrides_json=NULL WHERE id=?").run(run.id);
    db.close();
    db = await ProjectDatabase.open(join(tempDir, "projects.db"), secrets);
    repo = new ProjectRepository(db);

    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });
    await expect(
      service.exportToFile({ runId: run.id, format: "csv", destination: tempPath("csv") }),
    ).rejects.toMatchObject({
      backendError: {
        code: "LEGACY_COMPATIBILITY_REQUIRED",
        details: {
          kind: "legacy_compatibility_required",
          reason: "missing_semantic_override_snapshot",
          supportedSinceDatabaseSchemaVersion: 9,
        },
      },
    });
  });

  it("exports the semantic override captured when the Run was saved", async () => {
    const form: FormSnapshot = {
      ...makeMockForm(),
      questions: [{ id: "q_code" as never, title: "코드", kind: "text", textType: "short" }],
    };
    const source = makeMockResponses(1).map((response) => ({
      ...response,
      answers: {
        q_code: { state: "answered" as const, value: { kind: "text" as const, value: "123" } },
      },
    }));
    const created = repo.createFromImport("acc_1" as never, form, source);
    repo.setSemanticOverride(created.project.id, "q_code" as never, "numeric");
    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 2, questionTargets: [] },
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(2, true),
      synthetic: [
        {
          responseId: "synth_1" as never,
          createdAt: "2026-09-01T11:00:00Z",
          origin: "synthetic",
          answers: {
            q_code: { state: "answered", value: { kind: "text", value: "456" } },
          },
          path: { visitedQuestionIds: [], status: "complete" },
        },
      ],
    });
    repo.setSemanticOverride(created.project.id, "q_code" as never, "text");

    db.close();
    db = await ProjectDatabase.open(join(tempDir, "projects.db"), secrets);
    repo = new ProjectRepository(db);

    const historical = repo.loadHistoricalRunExportData(run.id);
    expect(historical.semanticOverrides).toEqual([
      { questionId: "q_code", value: "numeric", updatedAt: expect.any(String) },
    ]);

    const service = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });
    const destination = tempPath("xlsx");
    await service.exportToFile({ runId: run.id, format: "xlsx", destination });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(destination);
    const row = workbook.getWorksheet("응답")!.getRow(2);
    expect(row.getCell(2).type).toBe(ExcelJS.ValueType.Number);
    expect(row.getCell(2).value).toBe(123);
    expect(workbook.getWorksheet("응답")!.getRow(3).getCell(2).value).toBe(456);
  });

  it("exports valid run to CSV and XLSX directly via exportToFile", async () => {
    const form = makeMockForm();
    const created = repo.createFromImport("acc_1" as never, form, makeMockResponses(5));

    const targets: ProjectTargets = {
      targetResponseCount: 10,
      questionTargets: [],
    };
    const syntheticResponses: NormalizedResponse[] = Array.from({ length: 5 }, (_, i) => ({
      responseId: `synth_${i}` as never,
      createdAt: "2026-09-01T11:00:00Z",
      origin: "synthetic" as const,
      answers: {
        q_sat: { state: "answered", value: { kind: "ordinal", value: 5 } },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    const run = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets,
      targetRevision: 0,
      seed: 42,
      validation: makeMockValidation(10, true),
      synthetic: syntheticResponses,
    });

    const loggedEvents: Array<{ event: string; payload: unknown }> = [];
    const mockLogger = {
      info: (event: string, payload: unknown) => loggedEvents.push({ event, payload }),
      error: () => {},
      warn: () => {},
      debug: () => {},
    };

    const service = new ExportService({
      projects: repo,
      logger: mockLogger,
    });

    // Test CSV export
    const csvDest = tempPath("csv");
    const csvResult = await service.exportToFile({
      runId: run.id,
      format: "csv",
      destination: csvDest,
    });
    expect(csvResult.ok).toBe(true);
    expect(csvResult.cancelled).toBe(false);
    expect(csvResult.rowCount).toBe(10);
    expect(csvResult.columnCount).toBe(2);

    // Test XLSX export
    const xlsxDest = tempPath("xlsx");
    const xlsxResult = await service.exportToFile({
      runId: run.id,
      format: "xlsx",
      destination: xlsxDest,
    });
    expect(xlsxResult.ok).toBe(true);
    expect(xlsxResult.cancelled).toBe(false);
    expect(xlsxResult.rowCount).toBe(10);
    expect(xlsxResult.columnCount).toBe(2);

    // Verify safe logger: only safe diagnostics logged
    expect(loggedEvents).toHaveLength(2);
    expect(loggedEvents[0]?.event).toBe("run_export_completed");
    const payload = loggedEvents[0]?.payload as Record<string, unknown>;
    expect(payload.format).toBe("csv");
    expect(payload.rowCount).toBe(10);
    expect(payload.columnCount).toBe(2);
    expect(payload).not.toHaveProperty("answers");
    expect(payload).not.toHaveProperty("cells");
  });
});
