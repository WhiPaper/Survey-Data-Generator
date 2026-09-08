import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import { createRunExportService } from "../electron/main/export/service";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { persistRun } from "../electron/main/persistence/run-store";
import { createProject, createSourceRevision } from "../electron/main/persistence/store";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const directories: string[] = [];
const databases: AppDatabase[] = [];

const makeDatabase = (): { database: AppDatabase; directory: string } => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-export-"));
  directories.push(directory);
  const database = openAppDatabase({
    filename: join(directory, "survey-synth.sqlite"),
    migrationsFolder,
  });
  databases.push(database);
  return { database, directory };
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

const form = {
  formId: "form-1",
  title: "한국어 설문",
  capturedAt: "2026-09-06T00:00:00.000Z",
  schemaHash: "hash",
  sections: [{ id: "s1", title: "", order: 0, questionIds: ["q1", "q2"] }],
  questions: [
    {
      id: "q1",
      title: "점수",
      sectionId: "s1",
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: "q2",
      title: "메모",
      sectionId: "s1",
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    },
  ],
  groups: [],
  logic: {
    entrySectionId: "s1",
    sections: [{ id: "s1", order: 0, questionIds: ["q1", "q2"] }],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
} as unknown as FormSnapshot;

const makeResponse = (id: string, score: number, memo: string): NormalizedResponse =>
  ({
    responseId: id,
    answers: {
      q1: { state: "answered", value: { kind: "ordinal", value: score } },
      q2: { state: "answered", value: { kind: "text", value: memo } },
    },
    origin: "synthetic",
    path: { questions: {}, confidence: "certain" },
  }) as unknown as NormalizedResponse;

const response = makeResponse("response-1", 4, "=1+1");

const seedRun = (database: AppDatabase): void => {
  createProject(database.db, {
    id: "project-1",
    name: "한국어 설문",
    googleFormId: "form-1",
    nowMs: 1,
  });
  createSourceRevision(database.db, {
    projectId: "project-1",
    revisionId: "revision-1",
    importedAtMs: 2,
    responseSetHash: "hash",
    formSnapshot: {
      id: "snapshot-1",
      title: form.title,
      schema: form,
      schemaHash: form.schemaHash,
    },
    responses: [],
  });
  persistRun(database.db, {
    id: "run-1",
    projectId: "project-1",
    sourceRevisionId: "revision-1",
    scope: { kind: "all", responseCount: 0, responseSetHash: "hash" },
    finalResponseCount: 1,
    target: { finalCount: 1, sourceScope: { kind: "all" }, targets: [] },
    seed: 7,
    engineReport: {},
    rows: [
      {
        responseId: "response-1",
        submittedAtMs: Date.UTC(2026, 8, 6, 1, 2, 3),
        origin: "synthetic",
        response,
      },
    ],
  });
};

describe("M9 saved Run export", () => {
  it("writes equivalent CSV and XLSX values with safe spreadsheet text", async () => {
    const { database, directory } = makeDatabase();
    seedRun(database);
    const service = createRunExportService(database.db);
    const csvPath = join(directory, "result.csv");
    const xlsxPath = join(directory, "result.xlsx");

    await service.exportTo("run-1", "csv", csvPath);
    await service.exportTo("run-1", "xlsx", xlsxPath);

    const csv = readFileSync(csvPath, "utf8");
    expect(csv.startsWith("\uFEFF응답 제출 시간,점수,메모\r\n")).toBe(true);
    expect(csv).toContain("2026-09-06T01:02:03.000Z,4,'=1+1");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath);
    const sheet = workbook.getWorksheet("응답")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "응답 제출 시간", "점수", "메모"]);
    expect(sheet.getCell("B2").value).toBe(4);
    expect(sheet.getCell("C2").value).toBe("'=1+1");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("can compose a submitted-time Run back into its frozen full source revision", () => {
    const { database } = makeDatabase();
    createProject(database.db, {
      id: "project-1",
      name: "한국어 설문",
      googleFormId: "form-1",
      nowMs: 1,
    });

    const beforeMs = Date.UTC(2026, 7, 31, 23, 0, 0);
    const insideMs = Date.UTC(2026, 8, 1, 12, 0, 0);
    const afterMs = Date.UTC(2026, 8, 2, 1, 0, 0);
    const scopeStartMs = Date.UTC(2026, 8, 1, 0, 0, 0);
    const scopeEndMs = Date.UTC(2026, 8, 1, 23, 59, 59, 999);

    createSourceRevision(database.db, {
      projectId: "project-1",
      revisionId: "revision-1",
      importedAtMs: 2,
      responseSetHash: "hash",
      formSnapshot: {
        id: "snapshot-1",
        title: form.title,
        schema: form,
        schemaHash: form.schemaHash,
      },
      responses: [
        { responseId: "before", submittedAtMs: beforeMs, response: makeResponse("before", 2, "before") },
        { responseId: "inside", submittedAtMs: insideMs, response: makeResponse("inside", 3, "inside") },
        { responseId: "after", submittedAtMs: afterMs, response: makeResponse("after", 5, "after") },
      ],
    });

    persistRun(database.db, {
      id: "run-1",
      projectId: "project-1",
      sourceRevisionId: "revision-1",
      scope: {
        kind: "submitted_between",
        startMs: scopeStartMs,
        endMs: scopeEndMs,
        responseCount: 1,
        responseSetHash: "scope-hash",
      },
      finalResponseCount: 2,
      target: {
        finalCount: 2,
        sourceScope: {
          kind: "submitted_between",
          start: new Date(scopeStartMs).toISOString(),
          end: new Date(scopeEndMs).toISOString(),
        },
        targets: [],
      },
      seed: 7,
      engineReport: {},
      rows: [
        {
          responseId: "inside",
          submittedAtMs: insideMs,
          origin: "original",
          response: makeResponse("inside", 3, "inside"),
        },
        {
          responseId: "synthetic-1",
          submittedAtMs: Date.UTC(2026, 8, 1, 18, 0, 0),
          origin: "synthetic",
          response: makeResponse("synthetic-1", 4, "generated"),
        },
      ],
    });

    const service = createRunExportService(database.db);
    expect(service.buildTable("run-1").rows).toHaveLength(2);
    expect(service.buildTable("run-1", "full_source_revision").rows).toHaveLength(4);
  });
});
