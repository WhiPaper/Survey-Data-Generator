import { describe, expect, it } from "vitest";

import type { FrozenRunTarget } from "@survey-synth/contracts";

import { buildRunTargetPresentations } from "../electron/main/projects/run-presentation";

const form: Record<string, unknown> = {
  formId: "form-1",
  title: "Survey",
  questions: [
    {
      id: "q-segment",
      title: "관심 분야",
      kind: "single_choice",
      options: [
        { key: "festival", label: "축제" },
        { key: "performance", label: "공연" },
      ],
    },
    {
      id: "q-channel",
      title: "선호 채널",
      kind: "multi_choice",
      options: [
        { key: "music", label: "음악" },
        { key: "bus", label: "버스" },
      ],
    },
    { id: "q-score", title: "만족도", kind: "ordinal", min: 1, max: 5 },
  ],
};

const group = {
  id: "group-1",
  questionId: "q-segment",
  name: "행사 관심",
  members: ["festival", "performance"],
};

const targets: FrozenRunTarget[] = [
  { id: "t-mean" as never, kind: "mean", questionId: "q-score", value: 4.3 },
  {
    id: "t-share" as never,
    kind: "share",
    value: 0.4,
    subject: { kind: "option", questionId: "q-segment", optionKey: "festival" },
  },
  {
    id: "t-group" as never,
    kind: "share",
    value: 0.5,
    subject: { kind: "value_group", valueGroup: group },
  },
  {
    id: "t-conditional" as never,
    kind: "conditional_share",
    value: 0.6,
    questionId: "q-channel",
    optionKey: "music",
    population: { kind: "value_group", valueGroup: group },
  },
];

describe("historical Run target presentation", () => {
  it("derives labels from the Run Form snapshot and frozen ValueGroups", () => {
    expect(buildRunTargetPresentations(form, targets)).toEqual([
      {
        targetId: "t-mean",
        questionId: "q-score",
        questionTitle: "만족도",
        subjectLabel: "만족도",
      },
      {
        targetId: "t-share",
        questionId: "q-segment",
        questionTitle: "관심 분야",
        subjectLabel: "축제",
      },
      {
        targetId: "t-group",
        questionId: "q-segment",
        questionTitle: "관심 분야",
        subjectLabel: "행사 관심",
      },
      {
        targetId: "t-conditional",
        questionId: "q-channel",
        questionTitle: "선호 채널",
        subjectLabel: "음악",
        populationLabel: "행사 관심",
      },
    ]);
  });

  it("treats a missing historical target option as corrupted Run evidence", () => {
    expect(() =>
      buildRunTargetPresentations(form, [
        {
          id: "missing" as never,
          kind: "share",
          value: 0.5,
          subject: { kind: "option", questionId: "q-segment", optionKey: "missing" },
        },
      ]),
    ).toThrow("Historical Run option is missing from its Form snapshot");
  });
});
