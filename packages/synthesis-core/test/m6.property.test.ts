import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";
import { FeatureAccumulator, compileAdvancedFeatures } from "../src/index.js";

const form: FormSnapshot = {
  formId: "property" as never,
  title: "M6 property",
  capturedAt: "now",
  schemaHash: "m6-property",
  sections: [],
  groups: [],
  logic: {
    entrySectionId: "s" as never,
    sections: [],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
  questions: [
    {
      id: "check" as never,
      title: "Check",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "multi_choice",
      presentation: "checkbox",
      options: ["a", "b", "c"].map((key) => ({ key: key as never, label: key })),
      shuffle: false,
    },
  ],
};

const makeRow = (id: string, keys: readonly string[]): NormalizedResponse => ({
  responseId: id as never,
  origin: "synthetic",
  path: { questions: { check: "reached" } as never, confidence: "certain" },
  answers: {
    check: {
      state: "answered",
      value: { kind: "multi_choice", optionKeys: keys as never, labels: [...keys] },
    },
  },
});

describe("M6 FeatureAccumulator properties", () => {
  it("matches canonical full recomputation for random checkbox set replacements", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom("a", "b", "c"), { maxLength: 3 }),
        fc.uniqueArray(fc.constantFrom("a", "b", "c"), { maxLength: 3 }),
        (beforeKeys, afterKeys) => {
          const before = makeRow("one", beforeKeys);
          const stable = makeRow("two", ["a", "c"]);
          const after = makeRow("one", afterKeys);
          const features = compileAdvancedFeatures(form, [before, stable], []);
          const incremental = new FeatureAccumulator(features, [before, stable]);
          incremental.replace(before, after);
          expect(incremental.values()).toEqual(
            new FeatureAccumulator(features, [after, stable]).values(),
          );
        },
      ),
      { numRuns: 80 },
    );
  });
});
