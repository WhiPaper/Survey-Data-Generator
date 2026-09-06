import { describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import { renderCsv } from "../electron/main/export/csv";
import { buildLogicalExportTable } from "../electron/main/export/logical-table";
import { sanitizeSpreadsheetText } from "../electron/main/export/safety";

const form = {
  formId: "form-1",
  title: "설문",
  capturedAt: "2026-09-06T00:00:00.000Z",
  schemaHash: "hash",
  sections: [{ id: "section-1", title: "", order: 0, questionIds: ["q1", "q2", "q3"] }],
  questions: [
    {
      id: "q1",
      title: "선호",
      sectionId: "section-1",
      required: false,
      affectsNavigation: false,
      kind: "multi_choice",
      presentation: "checkbox",
      options: [
        { key: "a", label: "사과" },
        { key: "b", label: "바나나" },
      ],
      shuffle: false,
    },
    {
      id: "q2",
      title: "점수",
      sectionId: "section-1",
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: "q3",
      title: "메모",
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
    sections: [{ id: "section-1", order: 0, questionIds: ["q1", "q2", "q3"] }],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
} as unknown as FormSnapshot;

const response = (id: string, text: string): NormalizedResponse =>
  ({
    responseId: id,
    answers: {
      q1: {
        state: "answered",
        value: { kind: "multi_choice", optionKeys: ["b", "a"], labels: ["바나나", "사과"] },
      },
      q2: { state: "answered", value: { kind: "ordinal", value: 4 } },
      q3: { state: "answered", value: { kind: "text", value: text } },
    },
    origin: "synthetic",
    path: { questions: {}, confidence: "certain" },
  }) as unknown as NormalizedResponse;

describe("M9 logical export table", () => {
  it("orders rows stably and checkbox values in Form option order", () => {
    const table = buildLogicalExportTable(form, [
      { responseId: "b", submittedAtMs: 2000, response: response("b", "둘") },
      { responseId: "z", submittedAtMs: 1000, response: response("z", "셋") },
      { responseId: "a", submittedAtMs: 2000, response: response("a", "하나") },
    ]);

    expect(table.columns.map((column) => column.header)).toEqual([
      "응답 제출 시간",
      "선호",
      "점수",
      "메모",
    ]);
    expect(table.rows[0]!.cells[1]).toEqual({ kind: "text", value: "사과, 바나나" });
    expect(table.rows[1]!.cells[3]).toEqual({ kind: "text", value: "하나" });
    expect(table.rows[2]!.cells[3]).toEqual({ kind: "text", value: "둘" });
  });

  it("keeps CSV spreadsheet text formula-safe while preserving typed numbers", () => {
    const table = buildLogicalExportTable(form, [
      { responseId: "a", submittedAtMs: 0, response: response("a", "=1+1") },
    ]);
    const csv = renderCsv(table);

    expect(csv).toContain("사과, 바나나,4,'=1+1");
    expect(sanitizeSpreadsheetText("  +SUM(A1:A2)")).toBe("'  +SUM(A1:A2)");
    expect(sanitizeSpreadsheetText("일반 텍스트")).toBe("일반 텍스트");
  });
});
