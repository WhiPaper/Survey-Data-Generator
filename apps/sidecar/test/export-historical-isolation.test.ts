import { describe, expect, it, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectDatabase } from "../src/persistence/database.js";
import { ProjectRepository } from "../src/persistence/projects.js";
import { ExportService } from "../src/export/export-service.js";
import type { SecureSecretStore } from "../src/host.js";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";
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

const makeValidation = (count: number): ValidationResult => ({
  valid: true,
  originalMutationCount: 0,
  finalResponseCount: count,
  metrics: [],
  errors: [],
});

describe("Historical Run Export Isolation across Source Refresh", () => {
  let db: ProjectDatabase;
  let repo: ProjectRepository;
  let tempDir: string;
  const testFiles: string[] = [];

  const tempExportPath = (ext: "csv" | "xlsx"): string => {
    const path = resolve(tmpdir(), `hist_export_${randomUUID()}.${ext}`);
    testFiles.push(path);
    return path;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hist-export-db-"));
    const dbPath = join(tempDir, "projects.db");
    db = await ProjectDatabase.open(dbPath, new TestSecrets());
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

  it("exports R1 using strictly S1 form schema and data, and R2 using strictly S2 form schema and data, with Google and HiGHS unavailable", async () => {
    // 1. Setup S1: Form with q_common and q_s1_only
    const formS1: FormSnapshot = {
      formId: "form_hist_1" as never,
      title: "만족도 조사 v1",
      revision: 1,
      capturedAt: "2026-09-01T00:00:00Z",
      schemaHash: "hash_s1",
      groups: [],
      questions: [
        {
          id: "q_common" as never,
          title: "공통 질문",
          kind: "ordinal",
          scale: { min: 1, max: 5 },
        },
        {
          id: "q_s1_only" as never,
          title: "S1 전용 질문",
          kind: "single_choice",
          options: [
            { key: "opt_a" as never, label: "항목 A" },
            { key: "opt_b" as never, label: "항목 B" },
          ],
        },
      ],
    };

    const s1Originals: NormalizedResponse[] = Array.from({ length: 10 }, (_, i) => ({
      responseId: (i === 0 ? "shared_response" : `s1_orig_${i}`) as never,
      createdAt: "2026-09-01T10:00:00Z",
      origin: "original" as const,
      answers: {
        q_common: { state: "answered", value: { kind: "ordinal", value: 3 } },
        q_s1_only: {
          state: "answered",
          value: { kind: "single_choice", optionKey: "opt_a" as never, label: "항목 A" },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    const created = repo.createFromImport("acc_1" as never, formS1, s1Originals);
    const projectId = created.project.id;
    const revisionS1Id = created.project.currentSourceRevisionId;

    // Create and save Run R1 on S1 (10 originals + 10 synthetic = 20 total)
    const s1Synthetics: NormalizedResponse[] = Array.from({ length: 10 }, (_, i) => ({
      responseId: `s1_synth_${i}` as never,
      createdAt: "2026-09-01T11:00:00Z",
      origin: "synthetic" as const,
      answers: {
        q_common: { state: "answered", value: { kind: "ordinal", value: 4 } },
        q_s1_only: {
          state: "answered",
          value: { kind: "single_choice", optionKey: "opt_b" as never, label: "항목 B" },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    const runR1 = repo.saveRun({
      projectId,
      sourceRevisionId: revisionS1Id,
      targets: { targetResponseCount: 20, questionTargets: [] },
      targetRevision: 0,
      seed: 101,
      validation: makeValidation(20),
      synthetic: s1Synthetics,
    });

    // 2. Refresh project to S2: Form with q_common and q_s2_only (q_s1_only removed!)
    const formS2: FormSnapshot = {
      formId: "form_hist_1" as never,
      title: "만족도 조사 v2",
      revision: 2,
      capturedAt: "2026-09-02T00:00:00Z",
      schemaHash: "hash_s2",
      groups: [],
      questions: [
        {
          id: "q_common" as never,
          title: "공통 질문",
          kind: "ordinal",
          scale: { min: 1, max: 5 },
        },
        {
          id: "q_s2_only" as never,
          title: "S2 신규 질문",
          kind: "text",
          textType: "short",
        },
      ],
    };

    const s2Originals: NormalizedResponse[] = Array.from({ length: 12 }, (_, i) => ({
      responseId: (i === 0 ? "shared_response" : `s2_orig_${i}`) as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original" as const,
      answers: {
        q_common: { state: "answered", value: { kind: "ordinal", value: 5 } },
        q_s2_only: {
          state: "answered",
          value: { kind: "text", value: `피드백 ${i}` },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    // Record new source revision S2 for the project
    const { revisionId: revisionS2Id } = repo.createSourceRevision({
      projectId,
      form: formS2,
      responses: s2Originals,
      previousRevisionId: revisionS1Id,
      targets: { targetResponseCount: 25, questionTargets: [] },
      targetRevision: 1,
      issues: [],
      importedAt: "2026-09-02T10:05:00Z",
    });

    // Create and save Run R2 on S2 (12 originals + 13 synthetic = 25 total)
    const s2Synthetics: NormalizedResponse[] = Array.from({ length: 13 }, (_, i) => ({
      responseId: `s2_synth_${i}` as never,
      createdAt: "2026-09-02T11:00:00Z",
      origin: "synthetic" as const,
      answers: {
        q_common: { state: "answered", value: { kind: "ordinal", value: 5 } },
        q_s2_only: {
          state: "answered",
          value: { kind: "text", value: `합성 피드백 ${i}` },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    }));

    const runR2 = repo.saveRun({
      projectId,
      sourceRevisionId: revisionS2Id,
      targets: { targetResponseCount: 25, questionTargets: [] },
      targetRevision: 1,
      seed: 202,
      validation: makeValidation(25),
      synthetic: s2Synthetics,
    });

    // 2b. Refresh once more to S3, changing the shared response again.
    const formS3: FormSnapshot = {
      ...formS2,
      title: "만족도 조사 v3",
      revision: 3,
      capturedAt: "2026-09-03T00:00:00Z",
      schemaHash: "hash_s3",
      questions: [
        formS2.questions[0]!,
        {
          id: "q_s3_only" as never,
          title: "S3 신규 질문",
          kind: "text",
          textType: "short",
        },
      ],
    };
    const s3Originals = s2Originals.map((response, i) => ({
      ...response,
      createdAt: "2026-09-03T10:00:00Z",
      answers: {
        q_common: { state: "answered" as const, value: { kind: "ordinal" as const, value: 1 } },
        q_s3_only: {
          state: "answered" as const,
          value: { kind: "text" as const, value: `S3 피드백 ${i}` },
        },
      },
    }));
    const { revisionId: revisionS3Id } = repo.createSourceRevision({
      projectId,
      form: formS3,
      responses: s3Originals,
      previousRevisionId: revisionS2Id,
      targets: { targetResponseCount: 25, questionTargets: [] },
      targetRevision: 2,
      issues: [],
      importedAt: "2026-09-03T10:05:00Z",
    });

    // Verify current project pointer has moved to S3 while older Runs remain historical.
    const currentProject = repo.get(projectId)!;
    expect(currentProject.currentSourceRevisionId).toBe(revisionS3Id);
    expect(currentProject.currentSourceRevisionId).not.toBe(revisionS1Id);
    expect(currentProject.currentSourceRevisionId).not.toBe(revisionS2Id);

    // 3. Export both R1 and R2
    // Zero Google client, zero HiGHS solver worker
    const exportService = new ExportService({
      projects: repo,
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    });

    const r1CsvPath = tempExportPath("csv");
    const r1XlsxPath = tempExportPath("xlsx");
    const r2CsvPath = tempExportPath("csv");
    const r2XlsxPath = tempExportPath("xlsx");

    const r1CsvResult = await exportService.exportToFile({
      runId: runR1.id,
      format: "csv",
      destination: r1CsvPath,
    });
    await exportService.exportToFile({
      runId: runR1.id,
      format: "xlsx",
      destination: r1XlsxPath,
    });
    const r2CsvResult = await exportService.exportToFile({
      runId: runR2.id,
      format: "csv",
      destination: r2CsvPath,
    });
    await exportService.exportToFile({
      runId: runR2.id,
      format: "xlsx",
      destination: r2XlsxPath,
    });

    // 4. Assert R1 Export Semantics (Strictly S1)
    expect(r1CsvResult.rowCount).toBe(20);
    expect(r1CsvResult.columnCount).toBe(3); // Timestamp + 2 questions

    const r1CsvContent = await readFile(r1CsvPath, "utf8");
    expect(r1CsvContent).toContain("Response Timestamp,공통 질문,S1 전용 질문");
    expect(r1CsvContent).not.toContain("S2 신규 질문");
    expect(r1CsvContent).toContain("항목 A");
    expect(r1CsvContent).toContain("항목 B");
    expect(r1CsvContent).toContain(",3,항목 A");
    expect(r1CsvContent).not.toContain(",5,");
    expect(r1CsvContent).not.toContain("피드백");

    // R1 XLSX check
    const r1Wb = new ExcelJS.Workbook();
    await r1Wb.xlsx.readFile(r1XlsxPath);
    const r1Sheet = r1Wb.getWorksheet("응답")!;
    expect(r1Sheet.rowCount).toBe(21); // 1 header + 20 data rows
    const r1Headers = r1Sheet.getRow(1).values as string[];
    expect(r1Headers).toContain("S1 전용 질문");
    expect(r1Headers).not.toContain("S2 신규 질문");

    // 5. Assert R2 Export Semantics (Strictly S2)
    expect(r2CsvResult.rowCount).toBe(25);
    expect(r2CsvResult.columnCount).toBe(3); // Timestamp + 2 questions

    const r2CsvContent = await readFile(r2CsvPath, "utf8");
    expect(r2CsvContent).toContain("Response Timestamp,공통 질문,S2 신규 질문");
    expect(r2CsvContent).not.toContain("S1 전용 질문");
    expect(r2CsvContent).not.toContain("항목 A");
    expect(r2CsvContent).toContain(",5,피드백 0");
    expect(r2CsvContent).toContain("피드백 0");
    expect(r2CsvContent).toContain("합성 피드백 0");

    // R2 XLSX check
    const r2Wb = new ExcelJS.Workbook();
    await r2Wb.xlsx.readFile(r2XlsxPath);
    const r2Sheet = r2Wb.getWorksheet("응답")!;
    expect(r2Sheet.rowCount).toBe(26); // 1 header + 25 data rows
    const r2Headers = r2Sheet.getRow(1).values as string[];
    expect(r2Headers).toContain("S2 신규 질문");
    expect(r2Headers).not.toContain("S1 전용 질문");

    // 6. Invariant check: No provenance columns in default exports
    expect(r1CsvContent).not.toContain("is_synthetic");
    expect(r1CsvContent).not.toContain("seed");
    expect(r1CsvContent).not.toContain("run_id");
    expect(r2CsvContent).not.toContain("is_synthetic");
    expect(r2CsvContent).not.toContain("seed");
    expect(r2CsvContent).not.toContain("run_id");
  });
});
