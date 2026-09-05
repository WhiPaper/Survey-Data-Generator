import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { parquetWriteFile } from "hyparquet-writer";
import { afterEach, describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import {
  createFlatTablePlan,
  readResultParquet,
  valueGroupMemberCells,
  writeSourceParquet,
} from "../electron/main/synthesis/flat-table";

const directories: string[] = [];

const tempFile = (name: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-flat-"));
  directories.push(directory);
  return join(directory, name);
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

const form = {
  formId: "form-1",
  title: "Smoke form",
  capturedAt: "2026-09-01T00:00:00.000Z",
  schemaHash: "schema-1",
  sections: [
    { id: "__entry__", title: "", order: 0, questionIds: ["q-score", "q-text"] },
  ],
  questions: [
    {
      id: "q-score",
      title: "Satisfaction",
      sectionId: "__entry__",
      required: true,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: "q-text",
      title: "Comment",
      sectionId: "__entry__",
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    },
  ],
  groups: [],
  logic: {
    entrySectionId: "__entry__",
    sections: [{ id: "__entry__", order: 0, questionIds: ["q-score", "q-text"] }],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
} as unknown as FormSnapshot;

const original = {
  responseId: "r1",
  lastSubmittedAt: "2026-09-01T00:00:00.000Z",
  answers: {
    "q-score": { state: "answered", value: { kind: "ordinal", value: 4 } },
    "q-text": { state: "answered", value: { kind: "text", value: "good" } },
  },
  origin: "original",
  path: {
    questions: { "q-score": "reached", "q-text": "reached" },
    confidence: "certain",
  },
} as unknown as NormalizedResponse;

describe("synthesis flat parquet transport", () => {
  it("writes target score and lossless non-target answer slots", async () => {
    const path = tempFile("source.parquet");
    const plan = createFlatTablePlan(form, "q-score" as never);
    await writeSourceParquet(
      path,
      form,
      [
        {
          responseId: "r1",
          submittedAtMs: Date.parse("2026-09-01T00:00:00.000Z"),
          response: original,
        },
      ],
      plan,
    );

    const file = await asyncBufferFromFile(path);
    const rows = await parquetReadObjects({ file });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ response_id: "r1", target_score: 4 });
    expect(JSON.parse(String(rows[0]?.q_0))).toEqual(original.answers["q-text" as never]);
  });

  it("freezes choice and text ValueGroup members as exact observed AnswerSlot cells", () => {
    const festivalSlot = {
      state: "answered",
      value: { kind: "single_choice", optionKey: "festival", label: "축제" },
    };
    const familySlot = {
      state: "answered",
      value: { kind: "single_choice", optionKey: "family", label: "가족 나들이" },
    };
    const responses = [
      {
        responseId: "r1",
        submittedAtMs: 1,
        response: {
          responseId: "r1",
          answers: { "q-choice": festivalSlot },
          origin: "original",
          path: { questions: { "q-choice": "reached" }, confidence: "certain" },
        } as unknown as NormalizedResponse,
      },
      {
        responseId: "r2",
        submittedAtMs: 2,
        response: {
          responseId: "r2",
          answers: { "q-choice": familySlot },
          origin: "original",
          path: { questions: { "q-choice": "reached" }, confidence: "certain" },
        } as unknown as NormalizedResponse,
      },
    ];

    expect(valueGroupMemberCells(responses, "q-choice" as never, ["festival"])).toEqual([
      JSON.stringify(festivalSlot),
    ]);
    expect(valueGroupMemberCells(responses, "q-choice" as never, ["performance"])).toEqual([]);
    expect(
      valueGroupMemberCells(
        [{ responseId: "r-text", submittedAtMs: 3, response: original }],
        "q-text" as never,
        ["good"],
      ),
    ).toEqual([JSON.stringify(original.answers["q-text" as never])]);
  });

  it("reconstructs synthetic normalized responses and derives answer state from Form logic", async () => {
    const path = tempFile("result.parquet");
    parquetWriteFile({
      filename: path,
      columnData: [
        {
          name: "response_id",
          data: ["r1", "synthetic:42:1"],
          type: "STRING",
          nullable: false,
        },
        {
          name: "submitted_at",
          data: ["2026-09-01T00:00:00.000Z", "2026-09-01T00:01:00.000Z"],
          type: "STRING",
          nullable: false,
        },
        { name: "target_score", data: [4, 5], type: "DOUBLE", nullable: false },
        {
          name: "q_0",
          data: [
            JSON.stringify(original.answers["q-text" as never]),
            JSON.stringify({ state: "skipped" }),
          ],
          type: "STRING",
          nullable: false,
        },
        {
          name: "__origin",
          data: ["original", "synthetic"],
          type: "STRING",
          nullable: false,
        },
      ],
    });

    const plan = createFlatTablePlan(form, "q-score" as never);
    const rows = await readResultParquet(
      path,
      form,
      [
        {
          responseId: "r1",
          submittedAtMs: Date.parse("2026-09-01T00:00:00.000Z"),
          response: original,
        },
      ],
      plan,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.response).toEqual(original);
    expect(rows[1]).toMatchObject({ origin: "synthetic", responseId: "synthetic:42:1" });
    expect(rows[1]?.response.answers["q-score" as never]).toEqual({
      state: "answered",
      value: { kind: "ordinal", value: 5 },
    });
    expect(rows[1]?.response.answers["q-text" as never]).toEqual({ state: "skipped" });
    expect(rows[1]?.response.path.confidence).toBe("certain");
  });
});