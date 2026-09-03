import { describe, expect, it, afterEach } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExportSchema } from "../src/export/schema.js";
import { writeCsvExport, escapeCsvCell } from "../src/export/csv-writer.js";

describe("CSV writer", () => {
  const testFiles: string[] = [];

  const tempCsvPath = (): string => {
    const path = resolve(tmpdir(), `csv_test_${randomUUID()}.csv`);
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

  it("escapes CSV cells according to RFC 4180", () => {
    expect(escapeCsvCell("simple")).toBe("simple");
    expect(escapeCsvCell("with,comma")).toBe('"with,comma"');
    expect(escapeCsvCell('with "quote"')).toBe('"with ""quote"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("writes CSV with UTF-8 BOM, strict CRLF line endings, and Korean text", async () => {
    const destination = tempCsvPath();

    const mockSchema: ExportSchema = {
      columns: [
        { id: "timestamp", header: "Response Timestamp", type: "datetime" },
        { id: "q1", header: "만족도", type: "number" },
        { id: "q2", header: "의견", type: "string" },
        { id: "q3", header: "수식테스트", type: "string" },
      ],
      rowCount: 2,
      getRows: function* () {
        yield [
          {
            kind: "datetime",
            value: new Date("2026-09-02T10:00:00Z"),
            isoWithOffset: "2026-09-02T19:00:00+09:00",
          },
          { kind: "number", value: 5 },
          { kind: "text", value: "매우 만족합니다, 추천합니다!" },
          { kind: "text", value: "=SUM(A1:B1)" },
        ];
        yield [
          {
            kind: "datetime",
            value: new Date("2026-09-02T10:05:00Z"),
            isoWithOffset: "2026-09-02T19:05:00+09:00",
          },
          { kind: "empty" },
          { kind: "text", value: '첫 줄\n둘째 줄 "인용"' },
          { kind: "text", value: "+100" },
        ];
      },
    };

    const result = await writeCsvExport(mockSchema, destination);

    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(4);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const buffer = await readFile(destination);

    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const text = buffer.toString("utf8");

    expect(text.startsWith("\uFEFF")).toBe(true);

    const linesWithoutBom = text.slice(1);
    expect(linesWithoutBom).toContain("\r\n");
    const nonCrlfNewlines = linesWithoutBom.replace(/\r\n/g, "").includes("\r");
    expect(nonCrlfNewlines).toBe(false);

    expect(text).toContain("'=SUM(A1:B1)");
    expect(text).toContain("'+100");

    expect(text).toContain('"매우 만족합니다, 추천합니다!"');
    expect(text).toContain('""인용""');

    expect(text).toContain("만족도");
    expect(text).toContain("매우 만족합니다");
  });

  it("rejects an emitted-row count mismatch without replacing the destination", async () => {
    const destination = tempCsvPath();
    await writeFile(destination, "previous export", "utf8");
    const schema: ExportSchema = {
      columns: [{ id: "q1", header: "Q1", type: "string" }],
      rowCount: 1,
      getRows: function* () {
        // Intentionally emit no rows: the writer must not trust rowCount metadata.
      },
    };

    await expect(writeCsvExport(schema, destination)).rejects.toThrow(
      "Export row count mismatch: expected 1, found 0",
    );
    expect(await readFile(destination, "utf8")).toBe("previous export");
  });

  it("protects formula-like headers as well as response text", async () => {
    const destination = tempCsvPath();
    const schema: ExportSchema = {
      columns: [{ id: "q1", header: "=FORMULA", type: "string" }],
      rowCount: 1,
      getRows: function* () {
        yield [{ kind: "text", value: "safe" }];
      },
    };

    await writeCsvExport(schema, destination);
    expect((await readFile(destination, "utf8")).slice(0, 20)).toContain("'=FORMULA");
  });
});
