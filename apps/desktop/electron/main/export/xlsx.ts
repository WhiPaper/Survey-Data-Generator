import { rename, rm } from "node:fs/promises";

import ExcelJS from "exceljs";

import type { ExportCell, LogicalExportTable } from "./logical-table";
import { sanitizeSpreadsheetText } from "./safety";

const xlsxValue = (cell: ExportCell): unknown => {
  switch (cell.kind) {
    case "empty":
      return "";
    case "text":
      return sanitizeSpreadsheetText(cell.value);
    case "number":
      return cell.value;
    case "date":
    case "datetime":
      return cell.value;
    case "time":
      return cell.seconds / 86_400;
  }
};

export const writeXlsx = async (table: LogicalExportTable, destination: string): Promise<void> => {
  const tempPath = `${destination}.tmp`;
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tempPath,
      useStyles: true,
      useSharedStrings: true,
    });
    const worksheet = workbook.addWorksheet("응답", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    worksheet.columns = table.columns.map((column) => ({
      header: sanitizeSpreadsheetText(column.header),
      width: Math.min(50, Math.max(12, column.header.length + 4)),
    }));
    const header = worksheet.getRow(1);
    header.font = { bold: true };
    header.commit();

    for (const exportRow of table.rows) {
      const row = worksheet.addRow(exportRow.cells.map(xlsxValue));
      exportRow.cells.forEach((cell, index) => {
        const xlsxCell = row.getCell(index + 1);
        if (cell.kind === "date") xlsxCell.numFmt = "yyyy-mm-dd";
        else if (cell.kind === "datetime") xlsxCell.numFmt = "yyyy-mm-dd hh:mm:ss";
        else if (cell.kind === "time") xlsxCell.numFmt = cell.duration ? "[h]:mm" : "hh:mm";
        else if (cell.kind === "text" && (cell.value.includes("\n") || cell.value.length > 40)) {
          xlsxCell.alignment = { wrapText: true };
        }
      });
      row.commit();
    }

    if (table.columns.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, table.rows.length + 1), column: table.columns.length },
      };
    }
    await worksheet.commit();
    await workbook.commit();
    await rm(destination, { force: true });
    await rename(tempPath, destination);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};
