import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parquetWriteFile } from "hyparquet-writer";
import { afterEach, describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import {
  createFlatTablePlan,
  readResultParquet,
  valueGroupMemberCells,
} from "../electron/main/synthesis/flat-table";
import { semanticDuplicateTargetIssues } from "../electron/main/targets/semantic-key";

const directories: string[] = [];
const tempFile = (name: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-correctness-"));
  directories.push(directory);
  return join(directory, name);
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

const valueGroupForm = {
  formId: "form-value-group",
  title: "ValueGroup",
  capturedAt: "2026-09-07T00:00:00.000Z",
  schemaHash: "schema-value-group",
  sections: [
    {
      id: "section-1",
      title: "Main",
      order: 0,
      questionIds: ["q-choice", "q-text"],
    },
  ],
  questions: [
    {
      id: "q-choice",
      title: "Region",
      sectionId: "section-1",
      required: true,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "A", label: "A" },
        { key: "B", label: "B" },
        { key: "C", label: "C" },
      ],
      shuffle: false,
    },
    {
      id: "q-text",
      title: "Text",
      sectionId: "section-1",
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    },
  ],
  groups: [],
  logic: {
    entrySectionId: "section-1",
    sections: [{ id: "section-1", order: 0, questionIds: ["q-choice", "q-text"] }],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
} as unknown as FormSnapshot;

const storedResponse = (
  responseId: string,
  optionKey: "A" | "B",
  text: string,
): { responseId: string; submittedAtMs: number; response: NormalizedResponse } => ({
  responseId,
  submittedAtMs: 1,
  response: {
    responseId,
    answers: {
      "q-choice": {
        state: "answered",
        value: { kind: "single_choice", optionKey, label: optionKey },
      },
      "q-text": { state: "answered", value: { kind: "text", value: text } },
    },
    origin: "original",
    path: {
      questions: { "q-choice": "reached", "q-text": "reached" },
      confidence: "certain",
    },
  } as unknown as NormalizedResponse,
});

describe("correctness regressions", () => {
  it("includes schema-backed zero-observed single-choice ValueGroup members but not unseen text", () => {
    const responses = [storedResponse("r1", "A", "seen"), storedResponse("r2", "B", "other")];
    const canonicalA = JSON.stringify({
      state: "answered",
      value: { kind: "single_choice", optionKey: "A", label: "A" },
    });
    const canonicalC = JSON.stringify({
      state: "answered",
      value: { kind: "single_choice", optionKey: "C", label: "C" },
    });

    expect(
      valueGroupMemberCells(responses, "q-choice" as never, ["A", "C"], valueGroupForm),
    ).toEqual([canonicalA, canonicalC]);
    expect(
      valueGroupMemberCells(responses, "q-text" as never, ["seen", "unseen"], valueGroupForm),
    ).toEqual([JSON.stringify({ state: "answered", value: { kind: "text", value: "seen" } })]);
  });

  it("rejects a synthetic downstream answer after a confirmed submit branch", async () => {
    const form = {
      formId: "form-routing",
      title: "Routing",
      capturedAt: "2026-09-07T00:00:00.000Z",
      schemaHash: "schema-routing",
      sections: [
        { id: "s1", title: "Branch", order: 0, questionIds: ["q-branch"] },
        { id: "s2", title: "Downstream", order: 1, questionIds: ["q-score"] },
      ],
      questions: [
        {
          id: "q-branch",
          title: "Continue?",
          sectionId: "s1",
          required: true,
          affectsNavigation: true,
          kind: "single_choice",
          presentation: "radio",
          options: [
            { key: "A", label: "Submit" },
            { key: "B", label: "Continue" },
          ],
          shuffle: false,
        },
        {
          id: "q-score",
          title: "Score",
          sectionId: "s2",
          required: true,
          affectsNavigation: false,
          kind: "ordinal",
          presentation: "linear_scale",
          min: 1,
          max: 5,
        },
      ],
      groups: [],
      logic: {
        entrySectionId: "s1",
        sections: [
          { id: "s1", order: 0, questionIds: ["q-branch"], nextSectionId: "s2" },
          { id: "s2", order: 1, questionIds: ["q-score"] },
        ],
        transitions: [
          {
            sourceQuestionId: "q-branch",
            optionKey: "A",
            destination: { type: "submit" },
            evidence: "api_confirmed",
          },
          {
            sourceQuestionId: "q-branch",
            optionKey: "B",
            destination: { type: "next_section" },
            evidence: "api_confirmed",
          },
        ],
        coverage: "partial",
        hasRestartFlow: false,
      },
    } as unknown as FormSnapshot;
    const plan = createFlatTablePlan(form, ["q-score" as never]);
    const path = tempFile("result.parquet");
    parquetWriteFile({
      filename: path,
      columnData: [
        { name: "response_id", data: ["synthetic:1"], type: "STRING", nullable: false },
        {
          name: "submitted_at",
          data: ["2026-09-07T00:00:00.000Z"],
          type: "STRING",
          nullable: false,
        },
        { name: "target_score_0", data: [5], type: "DOUBLE", nullable: false },
        {
          name: "q_0",
          data: [
            JSON.stringify({
              state: "answered",
              value: { kind: "single_choice", optionKey: "A", label: "Submit" },
            }),
          ],
          type: "STRING",
          nullable: false,
        },
        { name: "__origin", data: ["synthetic"], type: "STRING", nullable: false },
      ],
    });

    await expect(readResultParquet(path, form, [], plan)).rejects.toThrow(
      "Generated candidate answered a confirmed not-reached question: Score",
    );
  });

  it("detects duplicate semantic metrics while allowing share plus count", () => {
    const option = { kind: "option" as const, questionId: "q-sex", optionKey: "female" };
    expect(
      semanticDuplicateTargetIssues([
        { id: "m1" as never, kind: "mean", questionId: "q-score", value: 3 },
        { id: "m2" as never, kind: "mean", questionId: "q-score", value: 4.5 },
      ]),
    ).toMatchObject([{ code: "target_conflict", targetIds: ["m1", "m2"] }]);
    expect(
      semanticDuplicateTargetIssues([
        { id: "s1" as never, kind: "share", subject: option, value: 0.4 },
        { id: "s2" as never, kind: "share", subject: option, value: 0.6 },
      ]),
    ).toMatchObject([{ code: "target_conflict", targetIds: ["s1", "s2"] }]);
    expect(
      semanticDuplicateTargetIssues([
        {
          id: "c1" as never,
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: "vg" },
          questionId: "q-check",
          optionKey: "A",
          value: 0.3,
        },
        {
          id: "c2" as never,
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: "vg" },
          questionId: "q-check",
          optionKey: "A",
          value: 0.7,
        },
      ]),
    ).toMatchObject([{ code: "target_conflict", targetIds: ["c1", "c2"] }]);
    expect(
      semanticDuplicateTargetIssues([
        { id: "share" as never, kind: "share", subject: option, value: 0.4 },
        { id: "count" as never, kind: "count", subject: option, value: 40 },
      ]),
    ).toEqual([]);
  });
});
