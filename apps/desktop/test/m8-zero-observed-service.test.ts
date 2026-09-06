import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { PythonEngine } from "../electron/main/compute/python-engine";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { valueGroups } from "../electron/main/persistence/schema";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import { createSynthesisService } from "../electron/main/synthesis/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("M8 zero-observed structured option boundary", () => {
  it("passes a Form-backed checkbox option to Python instead of rejecting zero observations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-synth-m8-option-"));
    directories.push(directory);
    const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
    databases.push(database);

    upsertGoogleAccount(database.db, {
      id: "account-1",
      email: "user@example.com",
      nowMs: 1000,
    });

    const populationSlot = {
      state: "answered",
      value: { kind: "single_choice", optionKey: "P", label: "서울" },
    };
    const observedCheckboxSlot = {
      state: "answered",
      value: { kind: "multi_choice", optionKeys: ["B"], labels: ["먹거리"] },
    };

    createImportedProject(database.db, {
      projectId: "project-1",
      revisionId: "revision-1",
      formSnapshotId: "snapshot-1",
      name: "Survey",
      googleAccountId: "account-1",
      googleFormId: "form-1",
      importedAtMs: 2000,
      responseSetHash: "hash-1",
      formSnapshot: {
        title: "Survey",
        schemaHash: "schema-1",
        capturedAtMs: 2000,
        schema: {
          formId: "form-1",
          title: "Survey",
          capturedAt: new Date(2000).toISOString(),
          schemaHash: "schema-1",
          sections: [
            {
              id: "section-1",
              title: "Main",
              order: 0,
              questionIds: ["q-score", "q-population", "q-checkbox"],
            },
          ],
          questions: [
            {
              id: "q-score",
              title: "Score",
              sectionId: "section-1",
              required: true,
              affectsNavigation: false,
              kind: "ordinal",
              presentation: "linear_scale",
              min: 1,
              max: 5,
            },
            {
              id: "q-population",
              title: "지역",
              sectionId: "section-1",
              required: true,
              affectsNavigation: false,
              kind: "single_choice",
              presentation: "radio",
              options: [{ key: "P", label: "서울" }],
            },
            {
              id: "q-checkbox",
              title: "관심 행사",
              sectionId: "section-1",
              required: false,
              affectsNavigation: false,
              kind: "multi_choice",
              presentation: "checkboxes",
              options: [
                { key: "A", label: "공연" },
                { key: "B", label: "먹거리" },
              ],
            },
          ],
          groups: [],
          logic: {
            entrySectionId: "section-1",
            sections: [
              {
                id: "section-1",
                order: 0,
                questionIds: ["q-score", "q-population", "q-checkbox"],
              },
            ],
            transitions: [],
            coverage: "none",
            hasRestartFlow: false,
          },
        },
      },
      responses: [1, 2].map((index) => ({
        responseId: `source-${index}`,
        submittedAtMs: 3000 + index * 1000,
        response: {
          responseId: `source-${index}`,
          answers: {
            "q-score": { state: "answered", value: { kind: "ordinal", value: 3 } },
            "q-population": populationSlot,
            "q-checkbox": observedCheckboxSlot,
          },
          origin: "original",
          path: {
            questions: {
              "q-score": "reached",
              "q-population": "reached",
              "q-checkbox": "reached",
            },
            confidence: "certain",
          },
        },
      })),
    });

    database.db
      .insert(valueGroups)
      .values({
        id: "group-seoul",
        projectId: "project-1",
        questionId: "q-population",
        name: "서울",
        membersJson: JSON.stringify(["P"]),
        createdAtMs: 2500,
        updatedAtMs: 2500,
      })
      .run();

    let capturedJob: Record<string, unknown> | null = null;
    const engine: PythonEngine = {
      selftest: async () => {
        throw new Error("unused");
      },
      synthesize: async (_operationId, jobPath) => {
        capturedJob = JSON.parse(await readFile(jobPath, "utf8")) as Record<string, unknown>;
        return {
          status: "infeasible",
          kind: "synthesize",
          sourceCount: 2,
          finalCount: 3,
          target: { kind: "mean", column: "target_score", value: 3 },
          shareTargets: [],
          conditionalShareTargets: [],
          issues: [{ code: "mock_stop", message: "job captured" }],
        };
      },
      cancel: () => false,
    };

    const service = createSynthesisService({
      db: database.db,
      engine,
      workRoot: join(directory, "jobs"),
    });
    const result = await service.start({
      projectId: "project-1",
      finalCount: 3,
      targets: [
        { kind: "mean", questionId: "q-score", value: 3 },
        {
          kind: "conditional_share",
          valueGroupId: "group-seoul",
          questionId: "q-checkbox",
          optionKey: "A",
          value: 1 / 3,
        },
      ],
      sourceScope: { kind: "all" },
      seed: 20260906,
      operationId: "m8-zero-observed-option",
    });

    expect(result).toEqual({
      status: "infeasible",
      issues: [{ code: "mock_stop", message: "job captured" }],
    });
    expect(capturedJob).not.toBeNull();
    const conditionalTargets = capturedJob?.conditional_share_targets as Array<
      Record<string, unknown>
    >;
    expect(conditionalTargets).toHaveLength(1);
    const canonical = JSON.stringify({
      state: "answered",
      value: { kind: "multi_choice", optionKeys: ["A"], labels: ["공연"] },
    });
    expect(conditionalTargets[0]).toMatchObject({
      option_values: [canonical],
      schema_option_values: [canonical],
    });
  });
});
