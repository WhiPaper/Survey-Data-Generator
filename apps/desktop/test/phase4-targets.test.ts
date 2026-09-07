import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { SynthesisStartParams, TargetDraft } from "@survey-synth/contracts";

import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { createImportedProject, upsertGoogleAccount } from "../electron/main/persistence/store";
import type { SynthesisService } from "../electron/main/synthesis/service";
import { createTargetService } from "../electron/main/targets/service";
import { createValueGroupService } from "../electron/main/value-groups/service";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const directories: string[] = [];

const setup = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-phase4-targets-"));
  directories.push(directory);
  const database = openAppDatabase({ filename: join(directory, "db.sqlite"), migrationsFolder });
  databases.push(database);

  upsertGoogleAccount(database.db, {
    id: "account-1",
    email: "user@example.com",
    nowMs: 1000,
  });
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
        questions: [
          {
            id: "q-gender",
            kind: "single_choice",
            options: [
              { key: "female", label: "여성" },
              { key: "male", label: "남성" },
            ],
          },
          { id: "q-score", kind: "ordinal", min: 1, max: 5 },
          { id: "q-city", kind: "text" },
          {
            id: "q-checkbox",
            kind: "multi_choice",
            options: [
              { key: "music", label: "음악" },
              { key: "bus", label: "버스" },
            ],
          },
        ],
      },
    },
    responses: [
      {
        responseId: "r1",
        submittedAtMs: 3000,
        response: {
          responseId: "r1",
          answers: {
            "q-gender": {
              state: "answered",
              value: { kind: "single_choice", optionKey: "female", label: "여성" },
            },
            "q-score": { state: "answered", value: { kind: "ordinal", value: 4 } },
            "q-city": { state: "answered", value: { kind: "text", value: "Seoul" } },
            "q-checkbox": {
              state: "answered",
              value: { kind: "multi_choice", optionKeys: ["music"], labels: ["음악"] },
            },
          },
          origin: "original",
          path: { questions: {}, confidence: "certain" },
        },
      },
      {
        responseId: "r2",
        submittedAtMs: 4000,
        response: {
          responseId: "r2",
          answers: {
            "q-gender": {
              state: "answered",
              value: { kind: "single_choice", optionKey: "male", label: "남성" },
            },
            "q-score": { state: "answered", value: { kind: "ordinal", value: 5 } },
            "q-city": { state: "answered", value: { kind: "text", value: "Busan" } },
            "q-checkbox": {
              state: "answered",
              value: { kind: "multi_choice", optionKeys: ["bus"], labels: ["버스"] },
            },
          },
          origin: "original",
          path: { questions: {}, confidence: "certain" },
        },
      },
    ],
  });
  return database;
};

const captureSynthesis = (capture: (params: SynthesisStartParams) => void): SynthesisService => ({
  start: async (params) => {
    capture(params);
    return { status: "infeasible", issues: [] };
  },
  resolveEditPlan: async () => {
    throw new Error("unused");
  },
  cancel: () => false,
  getRun: async () => {
    throw new Error("unused");
  },
});

const draft = (sourceScope: TargetDraft["sourceScope"]): TargetDraft => ({
  projectId: "project-1",
  finalCount: 4,
  sourceScope,
  seed: 42,
  targets: [
    {
      id: "t-share" as never,
      kind: "share",
      subject: { kind: "option", questionId: "q-gender", optionKey: "female" },
      intent: { kind: "relative_percent_delta", value: 0.1 },
    },
    {
      id: "t-count" as never,
      kind: "count",
      subject: { kind: "option", questionId: "q-gender", optionKey: "female" },
      intent: { kind: "count_delta", value: 1 },
    },
    {
      id: "t-mean" as never,
      kind: "mean",
      questionId: "q-score",
      intent: { kind: "absolute", value: 4.3 },
    },
  ],
});

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("Phase 4 target profile and draft lifecycle", () => {
  it("profiles the authoritative current values for the selected SourceScope", async () => {
    const database = setup();
    const service = createTargetService(
      database.db,
      captureSynthesis(() => undefined),
    );

    const group = await createValueGroupService(database.db).create({
      projectId: "project-1",
      questionId: "q-city",
      name: "서울",
      members: ["Seoul"],
    });

    const all = await service.profile("project-1", { kind: "all" });
    const femaleAll = all.metrics.find(
      (metric) =>
        metric.kind === "subject" &&
        metric.subject.kind === "option" &&
        metric.subject.questionId === "q-gender" &&
        metric.subject.optionKey === "female",
    );
    expect(all.responseCount).toBe(2);
    expect(femaleAll).toMatchObject({ count: 1, denominatorCount: 2, share: 0.5 });
    expect(
      all.metrics.find(
        (metric) => metric.kind === "ordinal_distribution" && metric.questionId === "q-score",
      ),
    ).toMatchObject({
      denominatorCount: 2,
      values: [
        { value: 1, count: 0, share: 0 },
        { value: 2, count: 0, share: 0 },
        { value: 3, count: 0, share: 0 },
        { value: 4, count: 1, share: 0.5 },
        { value: 5, count: 1, share: 0.5 },
      ],
    });
    expect(
      all.metrics.find(
        (metric) =>
          metric.kind === "conditional_share" &&
          metric.population.valueGroupId === group.id &&
          metric.questionId === "q-checkbox" &&
          metric.optionKey === "music",
      ),
    ).toMatchObject({ count: 1, denominatorCount: 1, share: 1 });

    const scoped = await service.profile("project-1", {
      kind: "submitted_between",
      start: new Date(3000).toISOString(),
      end: new Date(3000).toISOString(),
    });
    const femaleScoped = scoped.metrics.find(
      (metric) =>
        metric.kind === "subject" &&
        metric.subject.kind === "option" &&
        metric.subject.questionId === "q-gender" &&
        metric.subject.optionKey === "female",
    );
    expect(scoped.responseCount).toBe(1);
    expect(femaleScoped).toMatchObject({ count: 1, denominatorCount: 1, share: 1 });
    expect(scoped.responseSetHash).not.toBe(all.responseSetHash);
  });

  it("persists a mutable draft and resolves deltas from its frozen SourceScope baseline before synthesis", async () => {
    const database = setup();
    let captured: SynthesisStartParams | null = null;
    const service = createTargetService(
      database.db,
      captureSynthesis((params) => {
        captured = params;
      }),
    );
    const input = draft({ kind: "all" });

    const saved = await service.saveDraft(input);
    expect(saved.updatedAt).toBeTruthy();
    await expect(service.getDraft("project-1")).resolves.toMatchObject(input);

    await service.startDraft("project-1", "phase4-test");
    expect(captured).not.toBeNull();
    expect(captured?.sourceScope).toEqual({ kind: "all" });
    expect(captured?.operationId).toBe("phase4-test");
    expect(captured?.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "t-share", kind: "share", value: 0.55 }),
        expect.objectContaining({ id: "t-count", kind: "count", value: 2 }),
        expect.objectContaining({ id: "t-mean", kind: "mean", value: 4.3 }),
      ]),
    );
  });

  it("changes delta resolution when the draft SourceScope changes", async () => {
    const database = setup();
    let captured: SynthesisStartParams | null = null;
    const service = createTargetService(
      database.db,
      captureSynthesis((params) => {
        captured = params;
      }),
    );
    const input = draft({
      kind: "submitted_between",
      start: new Date(3000).toISOString(),
      end: new Date(3000).toISOString(),
    });
    input.targets = input.targets.filter((target) => target.kind !== "count");
    input.targets[0] = {
      id: "t-share" as never,
      kind: "share",
      subject: { kind: "option", questionId: "q-gender", optionKey: "female" },
      intent: { kind: "percentage_point_delta", value: -0.1 },
    };

    await service.saveDraft(input);
    await service.startDraft("project-1");
    expect(captured?.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "share", value: 0.9 })]),
    );
  });
});
