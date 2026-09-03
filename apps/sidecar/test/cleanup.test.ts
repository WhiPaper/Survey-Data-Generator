import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanupOrphanTempFiles, isOrphanTempFilename } from "../src/export/cleanup.js";

describe("orphan temp file cleanup", () => {
  it("recognizes orphan temp and backup file patterns", () => {
    expect(isOrphanTempFilename("export.csv.tmp.12345678-1234-1234-1234-123456789abc")).toBe(true);
    expect(isOrphanTempFilename("export.xlsx.bak.12345678-1234-1234-1234-123456789abc")).toBe(true);
    expect(isOrphanTempFilename("projects.db")).toBe(false);
    expect(isOrphanTempFilename("export.csv")).toBe(false);
    expect(isOrphanTempFilename("test.tmp")).toBe(false);
  });

  it("removes orphan temp files from directories while keeping valid files", async () => {
    const testDir = join(tmpdir(), `cleanup-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    const keep1 = join(testDir, "regular-file.txt");
    const keep2 = join(testDir, "export.xlsx");
    const staleTmp = join(testDir, `export.xlsx.tmp.${randomUUID()}`);
    const staleBak = join(testDir, `export.xlsx.bak.${randomUUID()}`);

    await writeFile(keep1, "keep this");
    await writeFile(keep2, "keep this too");
    await writeFile(staleTmp, "stale temp data");
    await writeFile(staleBak, "stale backup data");

    const cleaned = await cleanupOrphanTempFiles([testDir]);
    expect(cleaned).toBe(2);

    const remaining = await readdir(testDir);
    expect(remaining.sort()).toEqual(["export.xlsx", "regular-file.txt"]);

    await rm(testDir, { recursive: true, force: true });
  });

  it("handles non-existent or inaccessible directories gracefully", async () => {
    const nonExistent = join(tmpdir(), `does-not-exist-${randomUUID()}`);
    const cleaned = await cleanupOrphanTempFiles([nonExistent]);
    expect(cleaned).toBe(0);
  });
});
