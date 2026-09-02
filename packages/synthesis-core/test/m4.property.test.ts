import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import { synthesize } from "../src/index.js";

const form: FormSnapshot = {
  formId: "form" as never,
  title: "Property fixture",
  capturedAt: "now",
  schemaHash: "schema",
  sections: [],
  groups: [],
  logic: {
    entrySectionId: "section" as never,
    sections: [],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
  questions: [
    {
      id: "gender" as never,
      title: "Gender",
      sectionId: "section" as never,
      required: false,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "female" as never, label: "Female" },
        { key: "male" as never, label: "Male" },
      ],
      shuffle: false,
    },
  ],
};

describe("M4 generated target invariants", () => {
  it("never produces an invalid successful Run for small feasible exact counts", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 5 }),
        (femaleFlags, additionalFemale) => {
          const source: NormalizedResponse[] = femaleFlags.map((female, index) => ({
            responseId: `source-${index}` as never,
            origin: "original",
            path: { questions: {}, confidence: "certain" },
            answers: {
              gender: {
                state: "answered",
                value: {
                  kind: "single_choice",
                  optionKey: (female ? "female" : "male") as never,
                  label: female ? "Female" : "Male",
                },
              },
            },
          }));
          const originalJson = JSON.stringify(source);
          const originalFemale = femaleFlags.filter(Boolean).length;
          const targets: ProjectTargets = {
            targetResponseCount: source.length + 5,
            questionTargets: [
              {
                kind: "option",
                questionId: "gender" as never,
                optionKey: "female" as never,
                target: { kind: "count", value: originalFemale + additionalFemale },
              },
            ],
          };
          const result = synthesize(form, source, targets, 91);
          expect(result.kind).toBe("success");
          if (result.kind === "success") {
            expect(result.validation?.valid).toBe(true);
            expect(result.validation?.finalResponseCount).toBe(targets.targetResponseCount);
            expect(result.validation?.metrics[0]?.actual).toBe(originalFemale + additionalFemale);
          }
          expect(JSON.stringify(source)).toBe(originalJson);
        },
      ),
      { numRuns: 80 },
    );
  });
});
