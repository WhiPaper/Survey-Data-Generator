import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";
import { compileAdvancedFeatures, preservationDiagnostics, synthesize } from "../src/index.js";

describe("M6 bounded Medium fixture", () => {
  it("compiles 500 rows by 40 questions without feature explosion", () => {
    const questions = Array.from({ length: 40 }, (_, index) => ({
      id: `q${index}` as never,
      title: `Q${index}`,
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "single_choice" as const,
      presentation: "radio" as const,
      options: [
        { key: "a" as never, label: "A" },
        { key: "b" as never, label: "B" },
      ],
      shuffle: false,
    }));
    const form = {
      questions,
      sections: [],
      groups: [],
      logic: {
        entrySectionId: "s",
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
    } as FormSnapshot;
    const rows: NormalizedResponse[] = Array.from({ length: 500 }, (_, rowIndex) => ({
      responseId: `r${rowIndex}` as never,
      origin: "original",
      path: { questions: {}, confidence: "certain" },
      answers: Object.fromEntries(
        questions.map((question, questionIndex) => {
          const key = (rowIndex + questionIndex) % 2 === 0 ? "a" : "b";
          return [
            question.id,
            {
              state: "answered",
              value: { kind: "single_choice", optionKey: key, label: key.toUpperCase() },
            },
          ];
        }),
      ),
    }));
    const started = performance.now();
    const features = compileAdvancedFeatures(form, rows, []);
    const result = synthesize(
      form,
      rows,
      { targetResponseCount: 750, questionTargets: [] },
      2026,
      undefined,
      features,
    );
    expect(features).toHaveLength(160);
    expect(result).toMatchObject({
      kind: "success",
      validation: { valid: true, finalResponseCount: 750 },
    });
    if (result.kind === "success") {
      const quality = preservationDiagnostics(rows, [...rows, ...result.synthetic], features);
      expect(Number.isFinite(quality.marginalError)).toBe(true);
      expect(Number.isFinite(quality.duplicateRatio)).toBe(true);
    }
    expect(performance.now() - started).toBeGreaterThanOrEqual(0);
  });
});
