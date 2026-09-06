import { rename, rm, writeFile } from "node:fs/promises";

import type { ExportCell, LogicalExportTable } from "./logical-table";
import { sanitizeSpreadsheetText } from "./safety";

const escapeCsv = (value: string): string => {
  const sanitized = sanitizeSpreadsheetText(value);
  return /[",\r\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
};

export const renderExportCellCsv = (cell: ExportCell): string => {
  switch (cell.kind) {
    case "empty":
      return "";
    case "text":
      return escapeCsv(cell.value);
    case "number":
      return String(cell.value);
    case "date":
      return cell.value.toISOString().slice(0, 10);
    case "time": {
      const hours = Math.floor(cell.seconds / 3600);
      const minutes = Math.floor((cell.seconds % 3600) / 60);
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    case "datetime":
      return cell.isoWithOffset;
  }
};

export const renderCsv = (table: LogicalExportTable): string => {
  const lines = [
    table.columns.map((column) => escapeCsv(column.header)).join(","),
    ...table.rows.map((row) => row.cells.map(renderExportCellCsv).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

export const writeCsv = async (table: LogicalExportTable, destination: string): Promise<void> => {
  const tempPath = `${destination}.tmp`;
  try {
    await writeFile(tempPath, renderCsv(table), "utf8");
    await rm(destination, { force: true });
    await rename(tempPath, destination);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};
