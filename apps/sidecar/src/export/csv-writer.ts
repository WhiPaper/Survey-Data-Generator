import { stat } from "node:fs/promises";
import {
  assertExportRowCount,
  assertExportRowShape,
  type ExportCell,
  type ExportSchema,
} from "./schema.js";
import { sanitizeFormulaInjection } from "./safety.js";
import { createAtomicStream } from "./atomic-file.js";

const UTF8_BOM = "\uFEFF";
const CRLF = "\r\n";

export const escapeCsvCell = (value: string): string => {
  const needsQuote =
    value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");
  if (needsQuote) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const renderCellToCsv = (cell: ExportCell): string => {
  switch (cell.kind) {
    case "empty":
      return "";
    case "number":
      return String(cell.value);
    case "date":
      return cell.formatted;
    case "time":
      return escapeCsvCell(cell.value);
    case "datetime":
      return escapeCsvCell(cell.isoWithOffset);
    case "text": {
      const sanitized = sanitizeFormulaInjection(cell.value);
      return escapeCsvCell(sanitized);
    }
  }
};

export interface CsvExportResult {
  readonly destination: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly bytesWritten: number;
}

export const writeCsvExport = async (
  schema: ExportSchema,
  destination: string,
): Promise<CsvExportResult> => {
  const atomic = await createAtomicStream(destination);
  try {
    const stream = atomic.stream;

    const writeChunk = async (chunk: string): Promise<void> => {
      if (stream.write(chunk, "utf8")) return;
      await new Promise<void>((resolve, reject) => {
        const onDrain = (): void => {
          stream.off("error", onError);
          resolve();
        };
        const onError = (error: Error): void => {
          stream.off("drain", onDrain);
          reject(error);
        };
        stream.once("drain", onDrain);
        stream.once("error", onError);
      });
    };

    // Write UTF-8 BOM
    await writeChunk(UTF8_BOM);

    // Write header
    const headerRow =
      schema.columns.map((col) => escapeCsvCell(sanitizeFormulaInjection(col.header))).join(",") +
      CRLF;
    await writeChunk(headerRow);

    // Stream rows
    let rowCount = 0;
    for (const cells of schema.getRows()) {
      assertExportRowShape(schema, cells);
      const line = cells.map(renderCellToCsv).join(",") + CRLF;
      await writeChunk(line);
      rowCount += 1;
    }
    assertExportRowCount(schema, rowCount);

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
