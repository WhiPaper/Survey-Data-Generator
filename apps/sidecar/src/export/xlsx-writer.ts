import ExcelJS from "exceljs";
import { stat } from "node:fs/promises";
import { assertExportRowCount, assertExportRowShape, type ExportSchema } from "./schema.js";
import { sanitizeFormulaInjection } from "./safety.js";
import { createAtomicFile } from "./atomic-file.js";
import { sidecarError } from "../errors.js";

export const MAX_EXCEL_DATA_ROWS = 1_048_575;
export const MAX_EXCEL_COLUMNS = 16_384;

export const assertExcelRowLimit = (rowCount: number): void => {
  if (rowCount > MAX_EXCEL_DATA_ROWS) {
    throw sidecarError(
      "VALIDATION_FAILED",
      "Excel 파일로 저장하기에는 데이터가 너무 큽니다. CSV로 저장해주세요.",
      true,
    );
  }
};

export const assertExcelColumnLimit = (columnCount: number): void => {
  if (columnCount > MAX_EXCEL_COLUMNS) {
    throw sidecarError(
      "VALIDATION_FAILED",
      "Excel 파일의 열 한도를 초과했습니다. CSV로 저장해주세요.",
      true,
    );
  }
};

export interface XlsxExportResult {
  readonly destination: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly bytesWritten: number;
}

export const writeXlsxExport = async (
  schema: ExportSchema,
  destination: string,
): Promise<XlsxExportResult> => {
  assertExcelRowLimit(schema.rowCount);
  assertExcelColumnLimit(schema.columns.length);

  const atomic = await createAtomicFile(destination);
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: atomic.tempPath,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet("응답", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const columnsConfig = schema.columns.map((col) => {
      const width = Math.min(50, Math.max(12, col.header.length + 4));
      return { header: sanitizeFormulaInjection(col.header), width };
    });

    worksheet.columns = columnsConfig;
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    let rowCount = 0;
    for (const cells of schema.getRows()) {
      assertExportRowShape(schema, cells);
      if (rowCount >= MAX_EXCEL_DATA_ROWS) {
        assertExcelRowLimit(rowCount + 1);
      }
      const rowValues: unknown[] = [];
      for (let i = 0; i < schema.columns.length; i++) {
        const cell = cells[i]!;
        switch (cell.kind) {
          case "empty":
            rowValues.push("");
            break;
          case "number":
            rowValues.push(cell.value);
            break;
          case "date": {
            const dt = new Date(Date.UTC(cell.year, cell.month - 1, cell.day));
            rowValues.push(dt);
            break;
          }
          case "datetime":
            rowValues.push(cell.value);
            break;
          case "time":
            rowValues.push(cell.seconds / 86_400);
            break;
          case "text": {
            const sanitized = sanitizeFormulaInjection(cell.value);
            rowValues.push(sanitized);
            break;
          }
        }
      }

      const row = worksheet.addRow(rowValues);

      for (let i = 0; i < schema.columns.length; i++) {
        const cell = cells[i]!;
        const colNumber = i + 1;
        if (cell.kind === "date") {
          row.getCell(colNumber).numFmt = "yyyy-mm-dd";
        } else if (cell.kind === "datetime") {
          row.getCell(colNumber).numFmt = "yyyy-mm-dd hh:mm:ss";
        } else if (cell.kind === "time") {
          row.getCell(colNumber).numFmt = cell.duration ? "[h]:mm:ss" : "hh:mm";
        } else if (cell.kind === "text" && cell.value.includes("\n")) {
          row.getCell(colNumber).alignment = { wrapText: true };
        }
      }

      row.commit();
      rowCount += 1;
    }
    assertExportRowCount(schema, rowCount);

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rowCount + 1), column: schema.columns.length },
    };

    await worksheet.commit();
    await workbook.commit();
    await atomic.commit();

    const fileStat = await stat(destination);
    return {
      destination,
      rowCount,
      columnCount: schema.columns.length,
      bytesWritten: fileStat.size,
    };
  } catch (error) {
    await atomic.abort();
    throw error;
  }
};
