import { describe, expect, it, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExportSchema } from "../src/export/schema.js";
import {
  writeXlsxExport,
  assertExcelRowLimit,
  assertExcelColumnLimit,
  MAX_EXCEL_DATA_ROWS,
  MAX_EXCEL_COLUMNS,
} from "../src/export/xlsx-writer.js";

describe("XLSX writer", () => {
  const testFiles: string[] = [];

  const tempXlsxPath = (): string => {
    const path = resolve(tmpdir(), `xlsx_test_${randomUUID()}.xlsx`);
    testFiles.push(path);
    return path;
  };

  afterEach(async () => {
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

  it("tests row limit guard without allocating large fixtures", () => {
    expect(() => assertExcelRowLimit(MAX_EXCEL_DATA_ROWS)).not.toThrow();
    expect(() => assertExcelRowLimit(100)).not.toThrow();

    expect(() => assertExcelRowLimit(MAX_EXCEL_DATA_ROWS + 1)).toThrow(
      "Excel 파일로 저장하기에는 데이터가 너무 큽니다. CSV로 저장해주세요.",
    );
    expect(() => assertExcelRowLimit(2_000_000)).toThrow();
    expect(() => assertExcelColumnLimit(MAX_EXCEL_COLUMNS)).not.toThrow();
    expect(() => assertExcelColumnLimit(MAX_EXCEL_COLUMNS + 1)).toThrow(
      "Excel 파일의 열 한도를 초과했습니다. CSV로 저장해주세요.",
    );
  });

  it("writes valid XLSX workbook and reopens with ExcelJS verifying sheets, styles, freeze panes, autofilter, and cell types", async () => {
    const destination = tempXlsxPath();

    const mockSchema: ExportSchema = {
      columns: [
        { id: "timestamp", header: "Response Timestamp", type: "datetime" },
        { id: "q1", header: "만족도", type: "number" },
        { id: "q2", header: "출생일", type: "date" },
        { id: "q3", header: "비고", type: "string" },
        { id: "q4", header: "=HEADER", type: "string" },
      ],
      rowCount: 1,
      getRows: function* () {
        yield [
          {
            kind: "datetime",
            value: new Date(Date.UTC(2026, 8, 2, 19, 0, 0)),
            isoWithOffset: "2026-09-02T19:00:00+09:00",
          },
          { kind: "number", value: 4 },
          { kind: "date", year: 1995, month: 12, day: 25, formatted: "1995-12-25" },
          { kind: "text", value: "첫 번째 줄\n두 번째 줄" },
          { kind: "text", value: "=SUM(A1:A5)" },
        ];
      },
    };

    const result = await writeXlsxExport(mockSchema, destination);

    expect(result.rowCount).toBe(1);
    expect(result.columnCount).toBe(5);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(destination);

    expect(workbook.worksheets.length).toBe(1);
    const sheet = workbook.getWorksheet("응답");
    expect(sheet).toBeDefined();
    if (!sheet) throw new Error("Worksheet '응답' not found");

    expect(sheet.views.length).toBeGreaterThan(0);
    const firstView = sheet.views[0];
    expect(firstView?.state).toBe("frozen");
    expect(firstView?.ySplit).toBe(1);

    expect(sheet.autoFilter).toBeDefined();

    const headerRow = sheet.getRow(1);
    expect(headerRow.getCell(1).value).toBe("Response Timestamp");
    expect(headerRow.getCell(2).value).toBe("만족도");
    expect(headerRow.getCell(5).value).toBe("'=HEADER");
    expect(headerRow.font?.bold).toBe(true);

    const dataRow = sheet.getRow(2);
    expect(dataRow.getCell(2).type).toBe(ExcelJS.ValueType.Number);
    expect(dataRow.getCell(2).value).toBe(4);

    const dateCell = dataRow.getCell(3);
    expect(dateCell.type).toBe(ExcelJS.ValueType.Date);
    const dateVal = dateCell.value as Date;
    expect(dateVal.getUTCFullYear()).toBe(1995);
    expect(dateVal.getUTCMonth()).toBe(11);
    expect(dateVal.getUTCDate()).toBe(25);

    const timestampCell = dataRow.getCell(1);
    expect(timestampCell.type).toBe(ExcelJS.ValueType.Date);
    expect((timestampCell.value as Date).toISOString()).toBe("2026-09-02T19:00:00.000Z");

    const multilineCell = dataRow.getCell(4);
    expect(multilineCell.type).toBe(ExcelJS.ValueType.String);
    expect(multilineCell.value).toBe("첫 번째 줄\n두 번째 줄");
    expect(multilineCell.alignment?.wrapText).toBe(true);

    const formulaCell = dataRow.getCell(5);
    expect(formulaCell.type).toBe(ExcelJS.ValueType.String);
    expect(formulaCell.value).toBe("'=SUM(A1:A5)");
  });

  it("writes time-of-day and duration as numeric Excel time values", async () => {
    const destination = tempXlsxPath();
    const schema: ExportSchema = {
      columns: [
        { id: "time", header: "시각", type: "time" },
        { id: "duration", header: "소요 시간", type: "time" },
      ],
      rowCount: 1,
      getRows: function* () {
        yield [
          { kind: "time", value: "14:30", seconds: 52_200, duration: false },
          { kind: "time", value: "01:45:00", seconds: 6_300, duration: true },
        ];
      },
    };

    await writeXlsxExport(schema, destination);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(destination);
    const row = workbook.getWorksheet("응답")!.getRow(2);
    const timeValue = row.getCell(1).value as Date;
    expect(row.getCell(1).type).toBe(ExcelJS.ValueType.Date);
    expect(timeValue.toISOString()).toBe("1899-12-30T14:30:00.000Z");
    expect(row.getCell(1).numFmt).toBe("hh:mm");
    const durationValue = row.getCell(2).value as Date;
    expect(row.getCell(2).type).toBe(ExcelJS.ValueType.Date);
    expect(durationValue.toISOString()).toBe("1899-12-30T01:45:00.000Z");
    expect(row.getCell(2).numFmt).toBe("[h]:mm:ss");
  });
});
