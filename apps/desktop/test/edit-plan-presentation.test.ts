import { describe, expect, it } from "vitest";

import type { TargetOutcome } from "@survey-synth/contracts";

import { editPlanOutcomeValue } from "../src/QuestionExplorerPanel/editPlanPresentation";

const outcome = (kind: TargetOutcome["kind"], achieved: number): TargetOutcome => ({
  targetId: `target-${kind}` as never,
  kind,
  requested: achieved,
  achieved,
  absoluteError: 0,
  exact: true,
});

describe("edit plan outcome presentation", () => {
  it("formats share outcomes as percentages instead of raw fractions", () => {
    expect(editPlanOutcomeValue(outcome("share", 0.55))).toBe("55.0%");
    expect(editPlanOutcomeValue(outcome("conditional_share", 0.375))).toBe("37.5%");
  });

  it("formats counts and means with their normal product units", () => {
    expect(editPlanOutcomeValue(outcome("count", 42))).toBe("42명");
    expect(editPlanOutcomeValue(outcome("mean", 3.456))).toBe("3.46");
  });

  it("shows a neutral placeholder when the comparison result is missing", () => {
    expect(editPlanOutcomeValue(undefined)).toBe("—");
  });
});
