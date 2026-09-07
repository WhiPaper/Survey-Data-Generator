import type {
  SynthesisTarget,
  TargetDraftTarget,
  TargetIssue,
  TargetSubject,
} from "@survey-synth/contracts";

type SemanticTarget = SynthesisTarget | TargetDraftTarget;

const normalizedSubject = (subject: TargetSubject): string => {
  switch (subject.kind) {
    case "option":
      return `option:${subject.questionId}:${subject.optionKey}`;
    case "checkbox_option":
      return `checkbox_option:${subject.questionId}:${subject.optionKey}`;
    case "value_group":
      return `value_group:${subject.valueGroupId}`;
  }
};

export const semanticTargetKey = (target: SemanticTarget): string => {
  switch (target.kind) {
    case "mean":
      return `mean:${target.questionId}`;
    case "share":
      return `share:${normalizedSubject(target.subject)}`;
    case "count":
      return `count:${normalizedSubject(target.subject)}`;
    case "conditional_share":
      return `conditional_share:${target.population.valueGroupId}:${target.questionId}:${target.optionKey}`;
  }
};

export const semanticDuplicateTargetIssues = (
  targets: readonly SemanticTarget[],
): TargetIssue[] => {
  const grouped = new Map<string, SemanticTarget[]>();
  for (const target of targets) {
    const key = semanticTargetKey(target);
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }

  const issues: TargetIssue[] = [];
  for (const [key, group] of grouped) {
    const distinctIds = [...new Set(group.map((target) => String(target.id)))];
    if (distinctIds.length < 2) continue;
    issues.push({
      targetIds: distinctIds as TargetIssue["targetIds"],
      code: "target_conflict",
      message: `Duplicate semantic target: ${key}`,
    });
  }
  return issues;
};
