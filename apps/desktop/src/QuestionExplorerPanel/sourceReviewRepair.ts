import type { TargetDraft, TargetDraftTarget } from "@survey-synth/contracts";

const usesValueGroup = (target: TargetDraftTarget, valueGroupId: string): boolean => {
  if (target.kind === "conditional_share") {
    return target.population.valueGroupId === valueGroupId;
  }
  if (target.kind !== "share" && target.kind !== "count") return false;
  return target.subject.kind === "value_group" && target.subject.valueGroupId === valueGroupId;
};

export type ValueGroupRepairPlan = {
  draft: TargetDraft;
  removedTargetIds: string[];
};

export const planValueGroupRepair = (
  draft: TargetDraft,
  valueGroupId: string,
): ValueGroupRepairPlan => {
  const removedTargets = draft.targets.filter((target) => usesValueGroup(target, valueGroupId));
  if (removedTargets.length === 0) {
    return { draft, removedTargetIds: [] };
  }

  const removedIds = new Set(removedTargets.map((target) => String(target.id)));
  return {
    draft: {
      ...draft,
      targets: draft.targets.filter((target) => !removedIds.has(String(target.id))),
    },
    removedTargetIds: [...removedIds],
  };
};
