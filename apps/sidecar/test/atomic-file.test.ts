import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createAtomicFile, createAtomicStream } from "../src/export/atomic-file.js";

describe("atomic-file delivery", () => {
  const testFiles: string[] = [];

  const tempFilePath = (ext = "txt"): string => {
    const path = resolve(tmpdir(), `atomic_test_${randomUUID()}.${ext}`);
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

  it("writes atomically via createAtomicStream", async () => {
    const dest = tempFilePath();
    const atomic = await createAtomicStream(dest);

    atomic.stream.write("hello world\n");
    await atomic.commit();

    const content = await readFile(dest, "utf8");
    expect(content).toBe("hello world\n");
  });

  it("replaces existing destination file safely without data loss", async () => {
    const dest = tempFilePath();
    await writeFile(dest, "original content", "utf8");

    const atomic = await createAtomicStream(dest);
    atomic.stream.write("updated content");
    await atomic.commit();

    const content = await readFile(dest, "utf8");
    expect(content).toBe("updated content");
  });

  it("cleans up temporary file on abort and leaves original file untouched", async () => {
    const dest = tempFilePath();
    await writeFile(dest, "precious original content", "utf8");

    const atomic = await createAtomicStream(dest);
    atomic.stream.write("failed partial write");
    await atomic.abort();

    const content = await readFile(dest, "utf8");
    expect(content).toBe("precious original content");

    await expect(readFile(atomic.tempPath, "utf8")).rejects.toThrow();
  });

  it("createAtomicFile abort removes temp file", async () => {
    const dest = tempFilePath();
    const atomic = await createAtomicFile(dest);
    await writeFile(atomic.tempPath, "temp data", "utf8");
    await atomic.abort();

    await expect(readFile(atomic.tempPath, "utf8")).rejects.toThrow();
    await expect(readFile(dest, "utf8")).rejects.toThrow();
  });
});
