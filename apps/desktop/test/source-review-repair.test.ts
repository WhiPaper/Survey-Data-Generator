import { describe, expect, it, vi } from "vitest";

import type { TargetDraft } from "@survey-synth/contracts";

import {
  executeValueGroupRepair,
  planValueGroupRepair,
} from "../src/QuestionExplorerPanel/sourceReviewRepair";

const draft: TargetDraft = {
  projectId: "project-1",
  finalCount: 120,
  sourceScope: { kind: "all" },
  seed: 42,
  targets: [
    {
      id: "share:value_group:group-1" as never,
      kind: "share",
      subject: { kind: "value_group", valueGroupId: "group-1" },
      intent: { kind: "absolute", value: 0.5 },
    },
    {
      id: "count:value_group:group-2" as never,
      kind: "count",
      subject: { kind: "value_group", valueGroupId: "group-2" },
      intent: { kind: "absolute", value: 20 },
    },
    {
      id: "conditional:group-1" as never,
      kind: "conditional_share",
      population: { kind: "value_group", valueGroupId: "group-1" },
      questionId: "q-checkbox",
      optionKey: "opt-a",
      intent: { kind: "absolute", value: 0.6 },
    },
    {
      id: "share:option:q-choice:opt-a" as never,
      kind: "share",
      subject: { kind: "option", questionId: "q-choice", optionKey: "opt-a" },
      intent: { kind: "absolute", value: 0.4 },
    },
    {
      id: "mean:q-score" as never,
      kind: "mean",
      questionId: "q-score",
      intent: { kind: "absolute", value: 4.2 },
    },
  ],
};

describe("source review ValueGroup repair", () => {
  it("removes only targets that depend on the explicitly repaired group", () => {
    const plan = planValueGroupRepair(draft, "group-1");

    expect(plan.removedTargetIds).toEqual([
      "share:value_group:group-1",
      "conditional:group-1",
    ]);
    expect(plan.draft.targets.map((target) => String(target.id))).toEqual([
      "count:value_group:group-2",
      "share:option:q-choice:opt-a",
      "mean:q-score",
    ]);
    expect(draft.targets).toHaveLength(5);
  });

  it("reuses the current draft when the group has no target dependencies", () => {
    const plan = planValueGroupRepair(draft, "group-missing");

    expect(plan.removedTargetIds).toEqual([]);
    expect(plan.draft).toBe(draft);
  });

  it("persists the filtered draft before deleting the group", async () => {
    const calls: string[] = [];
    const persistDraft = vi.fn(async (nextDraft: TargetDraft) => {
      calls.push(`save:${nextDraft.targets.length}`);
    });
    const deleteGroup = vi.fn(async (valueGroupId: string) => {
      calls.push(`delete:${valueGroupId}`);
    });

    const plan = await executeValueGroupRepair({
      draft,
      valueGroupId: "group-1",
      persistDraft,
      deleteGroup,
    });

    expect(plan.removedTargetIds).toHaveLength(2);
    expect(calls).toEqual(["save:3", "delete:group-1"]);
  });

  it("does not delete the group when draft persistence fails", async () => {
    const persistDraft = vi.fn(async () => {
      throw new Error("save failed");
    });
    const deleteGroup = vi.fn(async () => undefined);

    await expect(
      executeValueGroupRepair({
        draft,
        valueGroupId: "group-1",
        persistDraft,
        deleteGroup,
      }),
    ).rejects.toThrow("save failed");
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("keeps the persisted target removal when group deletion fails", async () => {
    let savedDraft: TargetDraft | null = null;
    const persistDraft = vi.fn(async (nextDraft: TargetDraft) => {
      savedDraft = nextDraft;
    });
    const deleteGroup = vi.fn(async () => {
      throw new Error("delete failed");
    });

    await expect(
      executeValueGroupRepair({
        draft,
        valueGroupId: "group-1",
        persistDraft,
        deleteGroup,
      }),
    ).rejects.toThrow("delete failed");
    expect(savedDraft?.targets).toHaveLength(3);
  });
});
