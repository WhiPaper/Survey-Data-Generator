import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { VERSIONS } from "@survey-synth/contracts";
import { ProjectDatabase, ProjectRepository } from "../src/persistence/index.js";
import type { SecureSecretStore } from "../src/host.js";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

class TestSecretStore implements SecureSecretStore {
  public constructor(private readonly key: Uint8Array) {}
  public get(): Promise<Uint8Array | null> {
    return Promise.resolve(this.key);
  }
  public set(): Promise<void> {
    return Promise.resolve();
  }
  public delete(): Promise<void> {
    return Promise.resolve();
  }
}

describe("compiled sidecar export smoke", () => {
  it("starts sidecar from dist, unlocks encrypted SQLite, executes runs.export with host.dialog.save, and produces verified CSV and XLSX deliverables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-export-smoke-"));
    const rawKey = new Uint8Array(32).fill(42);
    const dbPath = join(directory, "projects.db");

    // Pre-populate project and valid run in encrypted DB before sidecar starts
    const db = await ProjectDatabase.open(dbPath, new TestSecretStore(rawKey));
    const repo = new ProjectRepository(db);

    const form: FormSnapshot = {
      formId: "form_smoke" as never,
      title: "연기 설문조사",
      revision: 1,
      capturedAt: "2026-09-01T00:00:00Z",
      schemaHash: "hash_smoke",
      groups: [],
      questions: [
        {
          id: "q_eval" as never,
          title: "만족도 평가",
          kind: "ordinal",
          scale: { min: 1, max: 5 },
        },
      ],
    };

    const originalResponses: NormalizedResponse[] = [
      {
        responseId: "resp_1" as never,
        createdAt: "2026-09-02T10:00:00Z",
        origin: "original",
        answers: {
          q_eval: { state: "answered", value: { kind: "ordinal", value: 5 } },
        },
        path: { visitedQuestionIds: [], status: "complete" },
      },
    ];

    const created = repo.createFromImport("acc_smoke" as never, form, originalResponses);

    const syntheticResponses: NormalizedResponse[] = [
      {
        responseId: "synth_1" as never,
        createdAt: "2026-09-02T11:00:00Z",
        origin: "synthetic",
        answers: {
          q_eval: { state: "answered", value: { kind: "ordinal", value: 4 } },
        },
        path: { visitedQuestionIds: [], status: "complete" },
      },
    ];

    const savedRun = repo.saveRun({
      projectId: created.project.id,
      sourceRevisionId: created.project.currentSourceRevisionId,
      targets: { targetResponseCount: 2, questionTargets: [] },
      targetRevision: 0,
      seed: 999,
      validation: {
        valid: true,
        originalMutationCount: 0,
        finalResponseCount: 2,
        metrics: [],
        errors: [],
      },
      synthetic: syntheticResponses,
    });

    db.close();

    // Launch compiled sidecar dist/main.js
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "main.js")], {
      cwd: process.cwd(),
      env: { ...process.env, SURVEY_SYNTH_APP_DATA_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const secretBase64 = Buffer.from(rawKey).toString("base64");
    let buffered = "";

    const targetCsvPath = resolve(directory, "smoke_export.csv");
    const targetXlsxPath = resolve(directory, "smoke_export.xlsx");

    let resolveCsvExport!: (value: unknown) => void;
    const csvExportPromise = new Promise<unknown>((resolve) => {
      resolveCsvExport = resolve;
    });

    let resolveXlsxExport!: (value: unknown) => void;
    const xlsxExportPromise = new Promise<unknown>((resolve) => {
      resolveXlsxExport = resolve;
    });

    let requestedFormat: "csv" | "xlsx" = "csv";

    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const chunks = buffered.split("\n");
      buffered = chunks.pop() ?? "";
      for (const line of chunks) {
        if (line.length === 0) continue;
        const message = JSON.parse(line) as {
          type?: string;
          id?: string;
          method?: string;
          params?: unknown;
          result?: unknown;
        };

        if (message.type === "host_request" && message.id !== undefined) {
          if (message.method === "host.secret.get") {
            child.stdin.write(
              `${JSON.stringify({
                v: VERSIONS.protocolVersion,
                type: "host_response",
                id: message.id,
                ok: true,
                result: { value: secretBase64 },
              })}\n`,
            );
          } else if (message.method === "host.dialog.save") {
            const selectedPath = requestedFormat === "csv" ? targetCsvPath : targetXlsxPath;
            child.stdin.write(
              `${JSON.stringify({
                v: VERSIONS.protocolVersion,
                type: "host_response",
                id: message.id,
                ok: true,
                result: { path: selectedPath },
              })}\n`,
            );
          } else {
            child.stdin.write(
              `${JSON.stringify({
                v: VERSIONS.protocolVersion,
                type: "host_response",
                id: message.id,
                ok: true,
                result: { ok: true },
              })}\n`,
            );
          }
        }

        if (message.type === "ready") {
          // Trigger CSV export
          requestedFormat = "csv";
          child.stdin.write(
            `${JSON.stringify({
              v: VERSIONS.protocolVersion,
              type: "request",
              id: "req_export_csv",
              method: "runs.export",
              params: { runId: savedRun.id, format: "csv" },
            })}\n`,
          );
        }

        if (message.type === "response" && message.id === "req_export_csv") {
          resolveCsvExport(message.result);
          // Trigger XLSX export
          requestedFormat = "xlsx";
          child.stdin.write(
            `${JSON.stringify({
              v: VERSIONS.protocolVersion,
              type: "request",
              id: "req_export_xlsx",
              method: "runs.export",
              params: { runId: savedRun.id, format: "xlsx" },
            })}\n`,
          );
        }

        if (message.type === "response" && message.id === "req_export_xlsx") {
          resolveXlsxExport(message.result);
          // Trigger shutdown
          child.stdin.write(
            `${JSON.stringify({
              v: VERSIONS.protocolVersion,
              type: "request",
              id: "req_shutdown",
              method: "system.shutdown",
              params: {},
            })}\n`,
          );
        }

        if (message.type === "response" && message.id === "req_shutdown") {
          child.stdin.end();
        }
      }
    });

    const csvResult = (await csvExportPromise) as {
      ok: boolean;
      cancelled: boolean;
      rowCount: number;
    };
    expect(csvResult.ok).toBe(true);
    expect(csvResult.cancelled).toBe(false);
    expect(csvResult.rowCount).toBe(2);

    const xlsxResult = (await xlsxExportPromise) as {
      ok: boolean;
      cancelled: boolean;
      rowCount: number;
    };
    expect(xlsxResult.ok).toBe(true);
    expect(xlsxResult.cancelled).toBe(false);
    expect(xlsxResult.rowCount).toBe(2);

    // Verify CSV output on disk
    const csvBuffer = await readFile(targetCsvPath);
    expect(csvBuffer[0]).toBe(0xef);
    expect(csvBuffer[1]).toBe(0xbb);
    expect(csvBuffer[2]).toBe(0xbf);
    const csvContent = csvBuffer.toString("utf8");
    expect(csvContent).toContain("Response Timestamp,만족도 평가\r\n");

    // Verify XLSX output on disk
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(targetXlsxPath);
    const sheet = workbook.getWorksheet("응답")!;
    expect(sheet).toBeDefined();
    expect(sheet.rowCount).toBe(3); // 1 header + 2 rows

    if (child.exitCode === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }, 30_000);
});
