import { describe, expect, it } from "vitest";

import type { RunTargetPresentation, TargetOutcome } from "@survey-synth/contracts";

import { resultTargetGroups } from "../src/QuestionExplorerPanel/resultTargetGroups";

const outcome = (targetId: string): TargetOutcome => ({
  targetId: targetId as never,
  kind: "share",
  requested: 0.5,
  achieved: 0.5,
  absoluteError: 0,
  exact: true,
});

const presentation = (
  targetId: string,
  questionId: string,
  questionOrder: number,
  questionTitle: string,
): RunTargetPresentation => ({
  targetId: targetId as never,
  questionId,
  questionOrder,
  questionTitle,
  subjectLabel: targetId,
});

describe("Result target groups", () => {
  it("groups targets by their frozen question and follows frozen Form order", () => {
    expect(
      resultTargetGroups(
        [outcome("late"), outcome("first-a"), outcome("first-b")],
        [
          presentation("late", "q-late", 4, "나중 문항"),
          presentation("first-a", "q-first", 0, "첫 문항"),
          presentation("first-b", "q-first", 0, "첫 문항"),
        ],
      ),
    ).toEqual([
      {
        questionId: "q-first",
        questionOrder: 0,
        questionTitle: "첫 문항",
        outcomes: [outcome("first-a"), outcome("first-b")],
      },
      {
        questionId: "q-late",
        questionOrder: 4,
        questionTitle: "나중 문항",
        outcomes: [outcome("late")],
      },
    ]);
  });
});
