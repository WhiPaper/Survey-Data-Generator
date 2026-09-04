import { describe, expect, it } from "vitest";

import type { ChoiceOption, ProjectTargets } from "@survey-synth/domain";

import { deriveSingleChoiceRatios, splitDistributionAdjustment } from "../src/lib/survey-targets";

const options = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
] as unknown as readonly ChoiceOption[];

describe("deriveSingleChoiceRatios", () => {
  it("keeps an edited target and redistributes the remaining choices by source share", () => {
    const targets = {
      targetResponseCount: 200,
      questionTargets: [
        {
          kind: "option",
          questionId: "question-1",
          optionKey: "a",
          target: { kind: "ratio", value: 0.5 },
        },
      ],
    } as unknown as ProjectTargets;

    const result = deriveSingleChoiceRatios(
      options,
      { a: 0.2, b: 0.3, c: 0.5 },
      targets,
      "question-1",
    );

    expect(result.get("a")).toBe(0.5);
    expect(result.get("b")).toBeCloseTo(0.1875);
    expect(result.get("c")).toBeCloseTo(0.3125);
  });

  it("uses final-count semantics for an explicit count", () => {
    const targets = {
      targetResponseCount: 200,
      questionTargets: [
        {
          kind: "option",
          questionId: "question-1",
          optionKey: "a",
          target: { kind: "count", value: 80 },
        },
      ],
    } as unknown as ProjectTargets;

    const result = deriveSingleChoiceRatios(
      options,
      { a: 0.2, b: 0.3, c: 0.5 },
      targets,
      "question-1",
    );

    expect(result.get("a")).toBe(0.4);
    expect(result.get("b")).toBeCloseTo(0.225);
    expect(result.get("c")).toBeCloseTo(0.375);
  });
});

describe("splitDistributionAdjustment", () => {
  it("stacks an increase above the original distribution", () => {
    expect(splitDistributionAdjustment(32, 45)).toEqual({
      existing: 32,
      increase: 13,
      decrease: 0,
    });
  });

  it("marks the removable portion while preserving the original stack height", () => {
    expect(splitDistributionAdjustment(32, 18)).toEqual({
      existing: 18,
      increase: 0,
      decrease: 14,
    });
  });
});
