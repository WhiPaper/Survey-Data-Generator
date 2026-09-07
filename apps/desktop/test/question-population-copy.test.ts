import { describe, expect, it } from "vitest";

import type { TargetProfileResult } from "@survey-synth/contracts";

import { questionPopulationText } from "../src/QuestionExplorerPanel/questionPopulation";
import type { QuestionView } from "../src/QuestionExplorerPanel/model";

const profile: TargetProfileResult = {
  projectId: "project-1" as never,
  sourceRevisionId: "revision-1",
  sourceScope: { kind: "all" },
  responseCount: 5,
  responseSetHash: "hash",
  metrics: [
    {
      kind: "subject",
      subject: { kind: "option", questionId: "q-choice", optionKey: "a" },
      count: 2,
      denominatorCount: 3,
      share: 2 / 3,
    },
    {
      kind: "subject",
      subject: { kind: "checkbox_option", questionId: "q-check", optionKey: "x" },
      count: 1,
      denominatorCount: 4,
      share: 0.25,
    },
    {
      kind: "ordinal_distribution",
      questionId: "q-score",
      denominatorCount: 2,
      values: [
        { value: 1, count: 1, share: 0.5 },
        { value: 2, count: 1, share: 0.5 },
      ],
    },
  ],
};

const question = (value: Partial<QuestionView> & Pick<QuestionView, "id" | "kind">): QuestionView => ({
  id: value.id,
  kind: value.kind,
  title: value.title ?? value.id,
  options: value.options ?? [],
  ...(value.min === undefined ? {} : { min: value.min }),
  ...(value.max === undefined ? {} : { max: value.max }),
});

describe("Question Explorer population copy", () => {
  it("uses the authoritative eligible denominator for single-choice and checkbox questions", () => {
    expect(
      questionPopulationText(
        question({ id: "q-choice", kind: "single_choice", options: [{ key: "a", label: "A" }] }),
        profile,
        5,
      ),
    ).toBe("단일 선택 · 응답 대상 3명");
    expect(
      questionPopulationText(
        question({ id: "q-check", kind: "multi_choice", options: [{ key: "x", label: "X" }] }),
        profile,
        5,
      ),
    ).toBe("복수 선택 · 응답 대상 4명");
  });

  it("uses the ordinal answered denominator instead of SourceScope size", () => {
    expect(questionPopulationText(question({ id: "q-score", kind: "ordinal" }), profile, 5)).toBe(
      "점수 · 응답 2명",
    );
  });

  it("does not claim an answered denominator for text when the public profile does not expose one", () => {
    expect(questionPopulationText(question({ id: "q-text", kind: "text" }), profile, 5)).toBe(
      "단답형 · 선택 범위 5명",
    );
  });
});
