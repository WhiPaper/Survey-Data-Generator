import { describe, expect, it } from "vitest";
import type { NormalizedResponse, QuestionId } from "@survey-synth/domain";
import { inferShortTextSemantic, profileBase, profileQuestion } from "../src/index.js";

const q = (id: string): QuestionId => id as QuestionId;
const response = (
  id: string,
  state: "answered" | "skipped" | "not_reached" | "indeterminate",
  value?: string,
): NormalizedResponse => ({
  responseId: id as never,
  origin: "original",
  answers: {
    [q("q")]:
      state === "answered" ? { state, value: { kind: "text", value: value ?? "" } } : { state },
  },
  path: { questions: {}, confidence: "certain" },
});

describe("question profiling", () => {
  it("keeps answer states distinct and uses confirmed eligibility", () => {
    const base = profileBase(q("q"), [
      response("1", "answered", "a"),
      response("2", "skipped"),
      response("3", "not_reached"),
      response("4", "indeterminate"),
    ]);
    expect(base).toMatchObject({
      answeredCount: 1,
      skippedCount: 1,
      notReachedCount: 1,
      indeterminateCount: 1,
      confirmedEligibleCount: 2,
      responseRate: 0.5,
    });
  });
  it("does not mistake leading-zero numeric strings for measurements", () => {
    const question = {
      id: q("q"),
      title: "Employee ID",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    } as const;
    const result = inferShortTextSemantic(question, [
      response("1", "answered", "00123"),
      response("2", "answered", "00124"),
      response("3", "answered", "00125"),
    ]);
    expect(result.inferred).toBe("identifier");
    expect(
      profileQuestion(question, [response("1", "answered", "00123")]).semanticInference?.inferred,
    ).toBe("identifier");
  });

  it("does not turn blank numeric text into zero and keeps empty ordinal bounds finite", () => {
    const textQuestion = {
      id: q("q"),
      title: "Age",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    } as const;
    const blank = profileQuestion(textQuestion, [response("1", "answered", " ")]);
    expect(blank.numeric).toBeUndefined();
    const ordinalQuestion = {
      id: q("q"),
      title: "Rating",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    } as const;
    const empty = profileQuestion(ordinalQuestion, [response("1", "skipped")]);
    expect(empty.numeric).toMatchObject({ count: 0, min: 0, max: 0 });
  });
});
