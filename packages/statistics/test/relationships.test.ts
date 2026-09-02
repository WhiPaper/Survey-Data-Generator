import { describe, expect, it } from "vitest";
import type { FormSnapshot, NormalizedResponse, QuestionId } from "@survey-synth/domain";
import { analyzeRelationships } from "../src/index.js";

const id = (v: string): QuestionId => v as QuestionId;
const form: FormSnapshot = {
  formId: "f" as never,
  title: "fixture",
  capturedAt: "now",
  schemaHash: "hash",
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
      id: id("a"),
      title: "A",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: id("b"),
      title: "B",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
  ],
};
const responses: NormalizedResponse[] = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5].map((n, i) => ({
  responseId: String(i) as never,
  origin: "original",
  answers: {
    [id("a")]: { state: "answered", value: { kind: "ordinal", value: n } },
    [id("b")]: { state: "answered", value: { kind: "ordinal", value: n } },
  },
  path: { questions: {}, confidence: "certain" },
}));

describe("relationships", () => {
  it("finds a monotonic ordinal relationship", () => {
    const result = analyzeRelationships(form, responses);
    expect(result[0]?.method).toBe("pearson_spearman");
    expect(result[0]?.strength).toBeCloseTo(1);
    expect(result[0]?.supportCount).toBe(10);
  });

  it("bounds and detects checkbox option co-occurrence", () => {
    const checkboxForm: FormSnapshot = {
      ...form,
      questions: [
        {
          id: id("c"),
          title: "Choices",
          sectionId: "s" as never,
          required: false,
          affectsNavigation: false,
          kind: "multi_choice",
          presentation: "checkbox",
          options: [
            { key: "x" as never, label: "X" },
            { key: "y" as never, label: "Y" },
          ],
          shuffle: false,
        },
      ],
    };
    const checkboxResponses = responses.map((response) => ({
      ...response,
      answers: {
        [id("c")]: {
          state: "answered" as const,
          value: {
            kind: "multi_choice" as const,
            optionKeys: ["x", "y"] as never[],
            labels: ["X", "Y"],
          },
        },
      },
    }));
    const result = analyzeRelationships(checkboxForm, checkboxResponses);
    expect(result[0]).toMatchObject({
      family: "checkbox_option_option",
      method: "phi_joint",
      supportCount: 10,
    });
  });

  it("uses inferred categorical text and preserves ordinal family semantics", () => {
    const categoricalText = {
      id: id("text"),
      title: "Department",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    } as const;
    const textForm = { ...form, questions: [...form.questions, categoricalText] };
    const textResponses = responses.map((r, i) => ({
      ...r,
      answers: {
        ...r.answers,
        [id("text")]: {
          state: "answered" as const,
          value: { kind: "text" as const, value: i % 2 === 0 ? "A" : "B" },
        },
      },
    }));
    const result = analyzeRelationships(textForm, textResponses);
    expect(
      result.some((item) => item.questionA === id("text") || item.questionB === id("text")),
    ).toBe(true);
    expect(
      result.find((item) => item.questionA === id("a") && item.questionB === id("b"))?.family,
    ).toBe("ordinal_ordinal");
  });
});
