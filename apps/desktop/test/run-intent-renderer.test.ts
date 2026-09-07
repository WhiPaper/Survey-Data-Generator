import { describe, expect, it } from "vitest";

import type { TargetIntent, TargetOutcome } from "@survey-synth/contracts";

import { runIntentLabel } from "../src/QuestionExplorerPanel/runIntent";

const outcome = (kind: TargetOutcome["kind"], requested: number): TargetOutcome => ({
  targetId: "target-1" as never,
  kind,
  requested,
  achieved: requested,
  absoluteError: 0,
  exact: true,
});

const label = (intent: TargetIntent | undefined, targetOutcome: TargetOutcome): string =>
  runIntentLabel(intent, targetOutcome);

describe("historical Run intent labels", () => {
  it("shows the original percentage-point change together with the resolved goal", () => {
    expect(label({ kind: "percentage_point_delta", value: 0.1 }, outcome("share", 0.45))).toBe(
      "+10.0%p / 목표 45.0%",
    );
  });

  it("shows the original relative-percent change together with the resolved goal", () => {
    expect(
      label({ kind: "relative_percent_delta", value: -0.2 }, outcome("conditional_share", 0.4)),
    ).toBe("-20.0% / 목표 40.0%");
  });

  it("shows count delta intent together with the resolved goal", () => {
    expect(label({ kind: "count_delta", value: 15 }, outcome("count", 65))).toBe(
      "+15명 / 목표 65명",
    );
  });

  it("falls back to the resolved goal for old Runs without frozen intent", () => {
    expect(label(undefined, outcome("mean", 4.3))).toBe("목표 4.30");
  });
});
