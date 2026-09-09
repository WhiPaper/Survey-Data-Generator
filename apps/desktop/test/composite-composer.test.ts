import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { composeCompositeRows } from "../electron/main/composites/composer";
import { persistComposite } from "../electron/main/persistence/composite-store";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { persistRun } from "../electron/main/persistence/run-store";
import { createImportedProject } from "../electron/main/persistence/store";
import { resolveSourceScope } from "../electron/main/source-scope";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];
const row = (id: string) => ({
  responseId: id as never,
  answers: {},
  origin: "original" as const,
  path: { questions: {}, confidence: "certain" as const },
});

afterEach(() => {
  while (databases.length) databases.pop()?.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("composite row composition", () => {
  it("replaces only disjoint scoped partitions and preserves the final-count invariant", () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-synth-composer-"));
    directories.push(directory);
    const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
    databases.push(database);
    createImportedProject(database.db, {
      projectId: "p",
      revisionId: "rev",
      formSnapshotId: "snapshot",
      name: "Survey",
      googleFormId: "form",
      responseSetHash: "hash",
      importedAtMs: 1,
      formSnapshot: {
        title: "Survey",
        schemaHash: "schema",
        capturedAtMs: 1,
        schema: { formId: "form", questions: [] },
      },
      responses: [1000, 2000, 3000].map((submittedAtMs, index) => ({
        responseId: `r${index + 1}`,
        submittedAtMs,
        response: row(`r${index + 1}`),
      })),
    });
    const scope = (startMs: number, endMs: number) => {
      const resolved = resolveSourceScope(database.db, "rev", {
        kind: "submitted_between",
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
      return {
        kind: "submitted_between" as const,
        startMs,
        endMs,
        responseCount: resolved.responseCount,
        responseSetHash: resolved.responseSetHash,
      };
    };
    persistRun(database.db, {
      id: "run-1",
      projectId: "p",
      sourceRevisionId: "rev",
      scope: scope(1000, 1000),
      finalResponseCount: 2,
      target: {
        finalCount: 2,
        sourceScope: {
          kind: "submitted_between",
          start: new Date(1000).toISOString(),
          end: new Date(1000).toISOString(),
        },
        targets: [],
      },
      seed: 1,
      engineReport: { achieved: { targets: [] } },
      rows: [
        { responseId: "r1", submittedAtMs: 1000, origin: "original", response: row("r1") },
        {
          responseId: "synthetic:1",
          submittedAtMs: 1500,
          origin: "synthetic",
          response: { ...row("synthetic:1"), origin: "synthetic" },
        },
      ],
    });
    persistRun(database.db, {
      id: "run-2",
      projectId: "p",
      sourceRevisionId: "rev",
      scope: scope(3000, 3000),
      finalResponseCount: 2,
      target: {
        finalCount: 2,
        sourceScope: {
          kind: "submitted_between",
          start: new Date(3000).toISOString(),
          end: new Date(3000).toISOString(),
        },
        targets: [],
      },
      seed: 1,
      engineReport: { achieved: { targets: [] } },
      rows: [
        { responseId: "r3", submittedAtMs: 3000, origin: "original", response: row("r3") },
        {
          responseId: "synthetic:1",
          submittedAtMs: 2500,
          origin: "synthetic",
          response: { ...row("synthetic:1"), origin: "synthetic" },
        },
      ],
    });
    persistComposite(database.db, {
      id: "composite",
      projectId: "p",
      sourceRevisionId: "rev",
      overlapPolicy: "reject",
      finalResponseCount: 5,
      children: [
        {
          ruleId: "august",
          runId: "run-1",
          count: { kind: "add", value: 1 },
          scopeResponseCount: 1,
          finalResponseCount: 2,
        },
        {
          ruleId: "september",
          runId: "run-2",
          count: { kind: "add", value: 1 },
          scopeResponseCount: 1,
          finalResponseCount: 2,
        },
      ],
    });
    const rows = composeCompositeRows(database.db, "composite");
    expect(rows).toHaveLength(5);
    expect(rows.map((item) => item.responseId)).toEqual([
      "r2",
      "r1",
      "august:synthetic:1",
      "r3",
      "september:synthetic:1",
    ]);
    expect(
      [...rows].sort((a, b) => a.submittedAtMs - b.submittedAtMs).map((item) => item.submittedAtMs),
    ).toEqual([1000, 1500, 2000, 2500, 3000]);
  });
});
