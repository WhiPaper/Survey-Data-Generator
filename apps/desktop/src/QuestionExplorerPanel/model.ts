import type {
  ProjectDetailView,
  TargetDraftTarget,
  TargetId,
  TargetIssue,
  TargetOutcome,
  TargetProfileMetric,
  TargetProfileResult,
  ValueGroupView,
} from "@survey-synth/contracts";

export type QuestionView = {
  id: string;
  title: string;
  kind: string;
  options: Array<{ key: string; label: string }>;
  min?: number;
  max?: number;
};

export type SubjectKind = "option" | "checkbox_option" | "value_group";

export type EditingTarget = {
  subjectKind: SubjectKind;
  questionId: string;
  questionTitle: string;
  label: string;
  optionKey?: string;
  valueGroupId?: string;
};

export type TargetMode =
  | "absolute_share"
  | "percentage_point_delta"
  | "relative_percent_delta"
  | "absolute_count"
  | "count_delta";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const projectQuestions = (project: ProjectDetailView): QuestionView[] => {
  const values = Array.isArray(project.form.questions) ? project.form.questions : [];
  return values.flatMap((value) => {
    const question = asRecord(value);
    if (!question || typeof question.id !== "string") return [];

    const options = Array.isArray(question.options)
      ? question.options.flatMap((candidate) => {
          const option = asRecord(candidate);
          if (!option || typeof option.key !== "string" || typeof option.label !== "string") {
            return [];
          }
          return [{ key: option.key, label: option.label }];
        })
      : [];

    return [
      {
        id: question.id,
        title:
          typeof question.title === "string" && question.title.length > 0
            ? question.title
            : question.id,
        kind: typeof question.kind === "string" ? question.kind : "unknown",
        options,
        ...(typeof question.min === "number" ? { min: question.min } : {}),
        ...(typeof question.max === "number" ? { max: question.max } : {}),
      },
    ];
  });
};

export const kindLabel = (kind: string): string => {
  if (kind === "single_choice") return "단일 선택";
  if (kind === "multi_choice") return "복수 선택";
  if (kind === "ordinal") return "점수";
  if (kind === "text") return "단답형";
  return "문항";
};

export const formatShare = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const formatSigned = (value: number, suffix: string): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

export const targetId = (value: string): TargetId => value as TargetId;

export const subjectTargetId = (kind: "share" | "count", editing: EditingTarget): TargetId => {
  if (editing.subjectKind === "value_group") {
    return targetId(`${kind}:value_group:${editing.valueGroupId ?? ""}`);
  }
  return targetId(
    `${kind}:${editing.subjectKind}:${editing.questionId}:${editing.optionKey ?? ""}`,
  );
};

export const conditionalTargetId = (
  valueGroupId: string,
  questionId: string,
  optionKey: string,
): TargetId => targetId(`conditional_share:value_group:${valueGroupId}:${questionId}:${optionKey}`);

export const meanTargetId = (questionId: string): TargetId => targetId(`mean:${questionId}`);

export const subjectTarget = (
  targets: readonly TargetDraftTarget[],
  editing: EditingTarget,
): Extract<TargetDraftTarget, { kind: "share" | "count" }> | undefined =>
  targets.find((target): target is Extract<TargetDraftTarget, { kind: "share" | "count" }> => {
    if (target.kind !== "share" && target.kind !== "count") return false;
    if (editing.subjectKind === "value_group") {
      return (
        target.subject.kind === "value_group" &&
        target.subject.valueGroupId === editing.valueGroupId
      );
    }
    return (
      target.subject.kind === editing.subjectKind &&
      target.subject.questionId === editing.questionId &&
      target.subject.optionKey === editing.optionKey
    );
  });

export const conditionalTarget = (
  targets: readonly TargetDraftTarget[],
  valueGroupId: string,
  questionId: string,
  optionKey: string,
): Extract<TargetDraftTarget, { kind: "conditional_share" }> | undefined =>
  targets.find(
    (target): target is Extract<TargetDraftTarget, { kind: "conditional_share" }> =>
      target.kind === "conditional_share" &&
      target.population.valueGroupId === valueGroupId &&
      target.questionId === questionId &&
      target.optionKey === optionKey,
  );

export const subjectMetricFor = (
  profile: TargetProfileResult | null,
  subjectKind: "option" | "checkbox_option",
  questionId: string,
  optionKey: string,
): Extract<TargetProfileMetric, { kind: "subject" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "subject" }> =>
      metric.kind === "subject" &&
      metric.subject.kind === subjectKind &&
      metric.subject.questionId === questionId &&
      metric.subject.optionKey === optionKey,
  );

export const valueGroupMetric = (
  profile: TargetProfileResult | null,
  valueGroupId: string,
): Extract<TargetProfileMetric, { kind: "subject" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "subject" }> =>
      metric.kind === "subject" &&
      metric.subject.kind === "value_group" &&
      metric.subject.valueGroupId === valueGroupId,
  );

export const conditionalProfileMetric = (
  profile: TargetProfileResult | null,
  valueGroupId: string,
  questionId: string,
  optionKey: string,
): Extract<TargetProfileMetric, { kind: "conditional_share" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "conditional_share" }> =>
      metric.kind === "conditional_share" &&
      metric.population.valueGroupId === valueGroupId &&
      metric.questionId === questionId &&
      metric.optionKey === optionKey,
  );

export const ordinalDistributionMetric = (
  profile: TargetProfileResult | null,
  questionId: string,
): Extract<TargetProfileMetric, { kind: "ordinal_distribution" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "ordinal_distribution" }> =>
      metric.kind === "ordinal_distribution" && metric.questionId === questionId,
  );

export const editingMetric = (
  profile: TargetProfileResult | null,
  editing: EditingTarget | null,
): Extract<TargetProfileMetric, { kind: "subject" }> | undefined => {
  if (!editing) return undefined;
  if (editing.subjectKind === "value_group") {
    return valueGroupMetric(profile, editing.valueGroupId ?? "");
  }
  return subjectMetricFor(
    profile,
    editing.subjectKind,
    editing.questionId,
    editing.optionKey ?? "",
  );
};

export const meanTarget = (
  targets: readonly TargetDraftTarget[],
  questionId: string,
): Extract<TargetDraftTarget, { kind: "mean" }> | undefined =>
  targets.find(
    (target): target is Extract<TargetDraftTarget, { kind: "mean" }> =>
      target.kind === "mean" && target.questionId === questionId,
  );

export const meanMetric = (
  profile: TargetProfileResult | null,
  questionId: string,
): Extract<TargetProfileMetric, { kind: "mean" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "mean" }> =>
      metric.kind === "mean" && metric.questionId === questionId,
  );

export const targetModeFor = (target: TargetDraftTarget | undefined): TargetMode => {
  if (!target?.intent) return "absolute_share";
  if (target.kind === "count") {
    return target.intent.kind === "count_delta" ? "count_delta" : "absolute_count";
  }
  if (target.intent.kind === "percentage_point_delta") return "percentage_point_delta";
  if (target.intent.kind === "relative_percent_delta") return "relative_percent_delta";
  return "absolute_share";
};

export const targetValueFor = (target: TargetDraftTarget | undefined): string => {
  if (!target?.intent) return "";
  if (target.kind === "count") return String(target.intent.value);
  return String(target.intent.value * 100);
};

export const targetSummary = (
  target: TargetDraftTarget | undefined,
  currentShare: number,
): string | null => {
  if (!target?.intent) return null;
  if (target.kind === "count") {
    return target.intent.kind === "count_delta"
      ? `${target.intent.value > 0 ? "+" : ""}${target.intent.value}명`
      : `최종 ${target.intent.value}명`;
  }
  if (target.kind !== "share" && target.kind !== "conditional_share") return null;
  if (target.intent.kind === "percentage_point_delta") {
    return `${formatSigned(target.intent.value * 100, "%p")} → ${formatShare(
      currentShare + target.intent.value,
    )}`;
  }
  if (target.intent.kind === "relative_percent_delta") {
    return `${formatSigned(target.intent.value * 100, "%")} → ${formatShare(
      currentShare * (1 + target.intent.value),
    )}`;
  }
  if (target.intent.kind === "absolute") return `→ ${formatShare(target.intent.value)}`;
  return null;
};

export const questionIdForTarget = (
  target: TargetDraftTarget,
  groups: readonly ValueGroupView[],
): string | null => {
  if (target.kind === "mean" || target.kind === "conditional_share") return target.questionId;
  const subject = target.subject;
  if (subject.kind === "value_group") {
    return groups.find((group) => group.id === subject.valueGroupId)?.questionId ?? null;
  }
  return subject.questionId;
};

export const dependentTargets = (
  targets: readonly TargetDraftTarget[],
  valueGroupId: string,
): TargetDraftTarget[] =>
  targets.filter((target) => {
    if (target.kind === "conditional_share") {
      return target.population.valueGroupId === valueGroupId;
    }
    if (target.kind !== "share" && target.kind !== "count") return false;
    return target.subject.kind === "value_group" && target.subject.valueGroupId === valueGroupId;
  });

export const targetLabel = (
  target: TargetDraftTarget,
  questions: readonly QuestionView[],
  groups: readonly ValueGroupView[],
): string => {
  if (target.kind === "mean") {
    return questions.find((question) => question.id === target.questionId)?.title ?? "평균";
  }
  if (target.kind === "conditional_share") {
    const question = questions.find((candidate) => candidate.id === target.questionId);
    const option = question?.options.find((candidate) => candidate.key === target.optionKey);
    const group = groups.find((candidate) => candidate.id === target.population.valueGroupId);
    return `${group?.name ?? "그룹"} 중 ${option?.label ?? "선택지"}`;
  }
  const subject = target.subject;
  if (subject.kind === "value_group") {
    return groups.find((group) => group.id === subject.valueGroupId)?.name ?? "그룹";
  }
  const question = questions.find((candidate) => candidate.id === subject.questionId);
  return question?.options.find((option) => option.key === subject.optionKey)?.label ?? "선택지";
};

export const issueMessage = (issue: TargetIssue): string => {
  if (issue.code === "out_of_range") return "목표 값이 가능한 범위를 벗어났습니다.";
  if (issue.code === "invalid_subject") {
    return "현재 원본에서 더 이상 사용할 수 없는 목표가 있습니다.";
  }
  if (issue.code === "immutable_source_conflict") {
    return "원본을 유지한 채로는 이 목표를 만들 수 없습니다.";
  }
  if (issue.code === "zero_denominator") {
    return "비율을 계산할 수 있는 응답 대상이 없습니다.";
  }
  if (issue.code === "target_conflict") return "서로 함께 만족할 수 없는 목표가 있습니다.";
  if (issue.code === "candidate_support") {
    return "현재 응답 구조로는 이 목표를 만들 수 없습니다.";
  }
  return "현재 설정에서는 지원되지 않는 목표가 있습니다.";
};

export const outcomeValue = (outcome: TargetOutcome): string => {
  if (outcome.kind === "share" || outcome.kind === "conditional_share") {
    return formatShare(outcome.achieved);
  }
  if (outcome.kind === "count") return `${Math.round(outcome.achieved)}명`;
  return outcome.achieved.toFixed(2);
};

export const requestedValue = (outcome: TargetOutcome): string => {
  if (outcome.kind === "share" || outcome.kind === "conditional_share") {
    return formatShare(outcome.requested);
  }
  if (outcome.kind === "count") return `${Math.round(outcome.requested)}명`;
  return outcome.requested.toFixed(2);
};

export const intentLabel = (
  target: TargetDraftTarget | undefined,
  outcome: TargetOutcome,
): string => {
  if (!target?.intent) return `목표 ${requestedValue(outcome)}`;
  if (target.kind === "count" && target.intent.kind === "count_delta") {
    return `${target.intent.value > 0 ? "+" : ""}${target.intent.value}명 / 목표 ${requestedValue(
      outcome,
    )}`;
  }
  if (target.kind !== "count" && target.kind !== "mean") {
    if (target.intent.kind === "percentage_point_delta") {
      return `${formatSigned(target.intent.value * 100, "%p")} / 목표 ${requestedValue(outcome)}`;
    }
    if (target.intent.kind === "relative_percent_delta") {
      return `${formatSigned(target.intent.value * 100, "%")} / 목표 ${requestedValue(outcome)}`;
    }
  }
  return `목표 ${requestedValue(outcome)}`;
};

export const currentValue = (
  target: TargetDraftTarget | undefined,
  profile: TargetProfileResult | null,
): string => {
  if (!target || !profile) return "—";
  if (target.kind === "mean") {
    const metric = meanMetric(profile, target.questionId);
    return metric ? metric.mean.toFixed(2) : "—";
  }
  if (target.kind === "conditional_share") {
    const metric = conditionalProfileMetric(
      profile,
      target.population.valueGroupId,
      target.questionId,
      target.optionKey,
    );
    return metric ? formatShare(metric.share) : "—";
  }
  const subject = target.subject;
  const metric =
    subject.kind === "value_group"
      ? valueGroupMetric(profile, subject.valueGroupId)
      : subjectMetricFor(profile, subject.kind, subject.questionId, subject.optionKey);
  if (!metric) return "—";
  return target.kind === "count" ? `${metric.count}명` : formatShare(metric.share);
};
