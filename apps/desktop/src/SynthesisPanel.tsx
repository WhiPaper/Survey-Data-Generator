import { useEffect, useMemo, useState } from "react";

import type {
  EditPlanTargetOutcome,
  ProjectDetailView,
  RunsGetResult,
  SourceScope,
  SynthesisStartResult,
  TargetDraft,
  TargetDraftTarget,
  TargetId,
  TargetOutcome,
  TargetProfileResult,
  ValueGroupObservedValue,
  ValueGroupView,
} from "@survey-synth/contracts";

import {
  cancelSynthesis,
  createValueGroup,
  deleteValueGroup,
  exportRun,
  getRun,
  getTargetDraft,
  getTargetProfile,
  listValueGroups,
  listValueGroupValues,
  resolveSynthesisEditPlan,
  saveTargetDraft,
  startTargetDraft,
} from "./api/backend";

type OrdinalQuestionView = { id: string; title: string; min: number; max: number };
type GroupableQuestionView = {
  id: string;
  title: string;
  kind: "single_choice" | "text";
};
type CheckboxQuestionView = {
  id: string;
  title: string;
  options: Array<{ key: string; label: string }>;
};
type ConditionalDraft = { optionKey: string; percent: string };
type ShareIntentKind = "absolute" | "percentage_point_delta" | "relative_percent_delta";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const questions = (project: ProjectDetailView): Record<string, unknown>[] =>
  Array.isArray(project.form.questions)
    ? project.form.questions.flatMap((value) => {
        const record = asRecord(value);
        return record ? [record] : [];
      })
    : [];

const questionTitle = (question: Record<string, unknown>): string =>
  typeof question.title === "string" && question.title.length > 0
    ? question.title
    : typeof question.id === "string"
      ? question.id
      : "질문";

const ordinalQuestions = (project: ProjectDetailView): OrdinalQuestionView[] =>
  questions(project).flatMap((question) => {
    if (
      question.kind !== "ordinal" ||
      typeof question.id !== "string" ||
      typeof question.min !== "number" ||
      typeof question.max !== "number"
    ) {
      return [];
    }
    return [
      {
        id: question.id,
        title: questionTitle(question),
        min: question.min,
        max: question.max,
      },
    ];
  });

const groupableQuestions = (project: ProjectDetailView): GroupableQuestionView[] =>
  questions(project).flatMap((question) => {
    if (
      (question.kind !== "single_choice" && question.kind !== "text") ||
      typeof question.id !== "string"
    ) {
      return [];
    }
    return [{ id: question.id, title: questionTitle(question), kind: question.kind }];
  });

const checkboxQuestions = (project: ProjectDetailView): CheckboxQuestionView[] =>
  questions(project).flatMap((question) => {
    if (
      question.kind !== "multi_choice" ||
      typeof question.id !== "string" ||
      !Array.isArray(question.options)
    ) {
      return [];
    }
    const options = question.options.flatMap((value) => {
      const option = asRecord(value);
      if (!option || typeof option.key !== "string" || typeof option.label !== "string") return [];
      return [{ key: option.key, label: option.label }];
    });
    return [{ id: question.id, title: questionTitle(question), options }];
  });

const targetId = (value: string): TargetId => value as TargetId;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

const outcomeLabel = (outcome: TargetOutcome): string => {
  const percentage = outcome.kind === "share" || outcome.kind === "conditional_share";
  const requested = percentage
    ? `${(outcome.requested * 100).toFixed(2)}%`
    : outcome.requested.toFixed(6);
  const achieved = percentage
    ? `${(outcome.achieved * 100).toFixed(2)}%`
    : outcome.achieved.toFixed(6);
  const error = percentage
    ? `${(outcome.absoluteError * 100).toFixed(2)}%p`
    : outcome.absoluteError.toFixed(6);
  const counts =
    outcome.numeratorCount === undefined
      ? ""
      : ` · ${outcome.numeratorCount}/${outcome.denominatorCount ?? "?"}`;
  return `${String(outcome.targetId)} · 요청 ${requested} · 달성 ${achieved} · 오차 ${error}${counts} · ${outcome.exact ? "정확히 표현됨" : "가장 가까운 표현"}`;
};

function EditPlanOutcomeView({
  label,
  outcome,
}: {
  label: string;
  outcome: EditPlanTargetOutcome;
}) {
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <strong>{label}</strong>
      {outcome.targets.map((target) => (
        <span key={String(target.targetId)}>{outcomeLabel(target)}</span>
      ))}
    </div>
  );
}

const qualityScore = (run: RunsGetResult | null): number | undefined => {
  if (!run) return undefined;
  const quality = asRecord(run.validation.quality);
  return typeof quality?.sdmetricsScore === "number" ? quality.sdmetricsScore : undefined;
};

const frozenTargetLabel = (
  run: RunsGetResult,
  outcome: TargetOutcome,
  checkbox: CheckboxQuestionView[],
): string => {
  const frozen = run.targetSnapshot.targets.find(
    (target) => String(target.id) === String(outcome.targetId),
  );
  if (!frozen) return String(outcome.targetId);
  if (frozen.kind === "share" || frozen.kind === "count") {
    const subject = frozen.subject;
    if (subject.kind === "value_group") return subject.valueGroup.name;
    const question = checkbox.find((candidate) => candidate.id === subject.questionId);
    const option = question?.options.find((candidate) => candidate.key === subject.optionKey);
    return option?.label ?? subject.optionKey;
  }
  if (frozen.kind === "conditional_share") {
    const question = checkbox.find((candidate) => candidate.id === frozen.questionId);
    const option = question?.options.find((candidate) => candidate.key === frozen.optionKey);
    return `${frozen.population.valueGroup.name} 중 ${option?.label ?? frozen.optionKey}`;
  }
  return String(outcome.targetId);
};

const shareIntentLabel = (kind: ShareIntentKind): string => {
  if (kind === "percentage_point_delta") return "현재값에서 증감 (%p)";
  if (kind === "relative_percent_delta") return "현재값 대비 증감 (%)";
  return "최종 share (%)";
};

export function SynthesisPanel({ project }: { project: ProjectDetailView }) {
  const ordinal = useMemo(() => ordinalQuestions(project), [project]);
  const groupable = useMemo(() => groupableQuestions(project), [project]);
  const checkbox = useMemo(() => checkboxQuestions(project), [project]);
  const [questionId, setQuestionId] = useState("");
  const [finalCount, setFinalCount] = useState(String(project.responseCount + 40));
  const [targetMean, setTargetMean] = useState("4.7");
  const [useRange, setUseRange] = useState(false);
  const [rangeStart, setRangeStart] = useState(project.responseTimestampRange?.start ?? "");
  const [rangeEnd, setRangeEnd] = useState(project.responseTimestampRange?.end ?? "");
  const [groups, setGroups] = useState<ValueGroupView[]>([]);
  const [groupQuestionId, setGroupQuestionId] = useState("");
  const [groupValues, setGroupValues] = useState<ValueGroupObservedValue[]>([]);
  const [groupValueQuery, setGroupValueQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [useShare, setUseShare] = useState(false);
  const [shareGroupId, setShareGroupId] = useState("");
  const [shareIntentKind, setShareIntentKind] = useState<ShareIntentKind>("absolute");
  const [targetSharePercent, setTargetSharePercent] = useState("35");
  const [useConditional, setUseConditional] = useState(false);
  const [conditionalGroupId, setConditionalGroupId] = useState("");
  const [conditionalQuestionId, setConditionalQuestionId] = useState("");
  const [conditionalDrafts, setConditionalDrafts] = useState<ConditionalDraft[]>([]);
  const [preservedTargets, setPreservedTargets] = useState<TargetDraftTarget[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState<TargetProfileResult | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisStartResult | null>(null);
  const [run, setRun] = useState<RunsGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadGroups = async (): Promise<void> => {
    const next = await listValueGroups(project.id);
    setGroups(next);
    const first = next[0]?.id ?? "";
    setShareGroupId((current) =>
      current && next.some((group) => group.id === current) ? current : first,
    );
    setConditionalGroupId((current) =>
      current && next.some((group) => group.id === current) ? current : first,
    );
  };

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setQuestionId(ordinal[0]?.id ?? "");
    setFinalCount(String(project.responseCount + 40));
    setTargetMean("4.7");
    setUseRange(false);
    setRangeStart(project.responseTimestampRange?.start ?? "");
    setRangeEnd(project.responseTimestampRange?.end ?? "");
    setGroupQuestionId(groupable[0]?.id ?? "");
    setGroupValueQuery("");
    setGroupName("");
    setGroupMembers([]);
    setUseShare(false);
    setShareIntentKind("absolute");
    setTargetSharePercent("35");
    setUseConditional(false);
    setConditionalQuestionId(checkbox[0]?.id ?? "");
    setConditionalDrafts([]);
    setPreservedTargets([]);
    setDraftStatus(null);
    setProfile(null);
    setOperationId(null);
    setPlanBusy(false);
    setExportBusy(false);
    setExportMessage(null);
    setResult(null);
    setRun(null);
    setError(null);

    void Promise.all([reloadGroups(), getTargetDraft(project.id)])
      .then(([, saved]) => {
        if (!active || !saved) return;
        setFinalCount(saved.finalCount === null ? "" : String(saved.finalCount));
        setUseRange(saved.sourceScope.kind === "submitted_between");
        if (saved.sourceScope.kind === "submitted_between") {
          setRangeStart(saved.sourceScope.start);
          setRangeEnd(saved.sourceScope.end);
        }

        const represented = new Set<string>();
        const mean = saved.targets.find(
          (target) => target.kind === "mean" && target.intent?.kind === "absolute",
        );
        if (mean?.kind === "mean" && mean.intent?.kind === "absolute") {
          setQuestionId(mean.questionId);
          setTargetMean(String(mean.intent.value));
          represented.add(String(mean.id));
        }

        const share = saved.targets.find(
          (target) =>
            target.kind === "share" &&
            target.subject.kind === "value_group" &&
            target.intent !== null &&
            (target.intent.kind === "absolute" ||
              target.intent.kind === "percentage_point_delta" ||
              target.intent.kind === "relative_percent_delta"),
        );
        if (share?.kind === "share" && share.subject.kind === "value_group" && share.intent) {
          setUseShare(true);
          setShareGroupId(share.subject.valueGroupId);
          setShareIntentKind(share.intent.kind as ShareIntentKind);
          setTargetSharePercent(String(share.intent.value * 100));
          represented.add(String(share.id));
        }

        const conditionals = saved.targets.filter(
          (target) => target.kind === "conditional_share" && target.intent?.kind === "absolute",
        );
        const firstConditional = conditionals[0];
        if (firstConditional?.kind === "conditional_share") {
          setUseConditional(true);
          setConditionalGroupId(firstConditional.population.valueGroupId);
          setConditionalQuestionId(firstConditional.questionId);
          const compatible = conditionals.filter(
            (target) =>
              target.kind === "conditional_share" &&
              target.population.valueGroupId === firstConditional.population.valueGroupId &&
              target.questionId === firstConditional.questionId &&
              target.intent?.kind === "absolute",
          );
          setConditionalDrafts(
            compatible.map((target) => ({
              optionKey: target.kind === "conditional_share" ? target.optionKey : "",
              percent: target.intent?.kind === "absolute" ? String(target.intent.value * 100) : "",
            })),
          );
          compatible.forEach((target) => represented.add(String(target.id)));
        }

        setPreservedTargets(saved.targets.filter((target) => !represented.has(String(target.id))));
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });

    return () => {
      active = false;
    };
  }, [project.id, project.currentSourceRevisionId, project.responseCount]);

  useEffect(() => {
    if (!groupQuestionId) {
      setGroupValues([]);
      return;
    }
    let active = true;
    setGroupBusy(true);
    void listValueGroupValues(project.id, groupQuestionId)
      .then((values) => {
        if (!active) return;
        setGroupValues(values);
        setGroupMembers((current) =>
          current.filter((member) => values.some((value) => value.value === member)),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setGroupBusy(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, groupQuestionId]);

  const selectedQuestion = ordinal.find((question) => question.id === questionId) ?? null;
  const selectedConditionalQuestion =
    checkbox.find((question) => question.id === conditionalQuestionId) ?? null;
  const currentQualityScore = qualityScore(run);
  const targetOutcomes = run?.outcome.targets ?? [];
  const filteredGroupValues = useMemo(() => {
    const query = groupValueQuery.trim().toLocaleLowerCase();
    if (!query) return groupValues;
    return groupValues.filter(
      (value) =>
        value.label.toLocaleLowerCase().includes(query) ||
        value.value.toLocaleLowerCase().includes(query),
    );
  }, [groupValueQuery, groupValues]);

  const sourceScope = useMemo<SourceScope>(
    () =>
      useRange
        ? { kind: "submitted_between", start: rangeStart.trim(), end: rangeEnd.trim() }
        : { kind: "all" },
    [rangeEnd, rangeStart, useRange],
  );

  const currentDraft = useMemo<TargetDraft>(() => {
    const parsedFinalCount = Number(finalCount);
    const parsedMean = Number(targetMean);
    const targets: TargetDraftTarget[] = [...preservedTargets];

    if (selectedQuestion) {
      targets.push({
        id: targetId(`mean:${selectedQuestion.id}`),
        kind: "mean",
        questionId: selectedQuestion.id,
        intent: Number.isFinite(parsedMean) ? { kind: "absolute", value: parsedMean } : null,
      });
    }

    if (useShare && shareGroupId) {
      const value = Number(targetSharePercent) / 100;
      targets.push({
        id: targetId(`share:value-group:${shareGroupId}`),
        kind: "share",
        subject: { kind: "value_group", valueGroupId: shareGroupId },
        intent: Number.isFinite(value) ? { kind: shareIntentKind, value } : null,
      });
    }

    if (useConditional && conditionalGroupId && selectedConditionalQuestion) {
      for (const conditional of conditionalDrafts) {
        const value = Number(conditional.percent) / 100;
        targets.push({
          id: targetId(
            `conditional:${conditionalGroupId}:${selectedConditionalQuestion.id}:${conditional.optionKey}`,
          ),
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: conditionalGroupId },
          questionId: selectedConditionalQuestion.id,
          optionKey: conditional.optionKey,
          intent: Number.isFinite(value) ? { kind: "absolute", value } : null,
        });
      }
    }

    return {
      projectId: project.id,
      finalCount:
        Number.isInteger(parsedFinalCount) && parsedFinalCount > 0 ? parsedFinalCount : null,
      sourceScope,
      seed: 42,
      targets,
    };
  }, [
    conditionalDrafts,
    conditionalGroupId,
    finalCount,
    preservedTargets,
    project.id,
    selectedConditionalQuestion,
    selectedQuestion,
    shareGroupId,
    shareIntentKind,
    sourceScope,
    targetMean,
    targetSharePercent,
    useConditional,
    useShare,
  ]);

  useEffect(() => {
    if (!draftReady) return;
    if (
      sourceScope.kind === "submitted_between" &&
      (sourceScope.start.length === 0 || sourceScope.end.length === 0)
    ) {
      setProfile(null);
      return;
    }
    let active = true;
    void getTargetProfile(project.id, sourceScope)
      .then((next) => {
        if (active) setProfile(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [draftReady, project.id, sourceScope]);

  useEffect(() => {
    if (!draftReady) return;
    setDraftStatus("저장 중…");
    const timer = window.setTimeout(() => {
      void saveTargetDraft(currentDraft)
        .then(() => setDraftStatus("자동 저장됨"))
        .catch((cause: unknown) => {
          setDraftStatus(null);
          setError(errorMessage(cause));
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [currentDraft, draftReady]);

  const handleCreateGroup = async (): Promise<void> => {
    if (!groupQuestionId || !groupName.trim() || groupMembers.length === 0) {
      setError("ValueGroup 이름과 하나 이상의 멤버가 필요합니다.");
      return;
    }
    setGroupBusy(true);
    setError(null);
    try {
      const created = await createValueGroup({
        projectId: project.id,
        questionId: groupQuestionId,
        name: groupName.trim(),
        members: groupMembers,
      });
      setGroupName("");
      setGroupMembers([]);
      await reloadGroups();
      setShareGroupId(created.id);
      setConditionalGroupId(created.id);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setGroupBusy(false);
    }
  };

  const handleDeleteGroup = async (group: ValueGroupView): Promise<void> => {
    if (
      !window.confirm(
        `ValueGroup “${group.name}”을 삭제할까요? 기존 Run의 frozen snapshot은 유지됩니다.`,
      )
    ) {
      return;
    }
    setGroupBusy(true);
    setError(null);
    try {
      await deleteValueGroup(group.id);
      await reloadGroups();
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setGroupBusy(false);
    }
  };

  const toggleConditionalOption = (optionKey: string, checked: boolean): void => {
    setConditionalDrafts((current) => {
      if (checked) {
        return current.some((draft) => draft.optionKey === optionKey)
          ? current
          : [...current, { optionKey, percent: "50" }];
      }
      return current.filter((draft) => draft.optionKey !== optionKey);
    });
  };

  const updateConditionalPercent = (optionKey: string, percent: string): void => {
    setConditionalDrafts((current) =>
      current.map((draft) => (draft.optionKey === optionKey ? { ...draft, percent } : draft)),
    );
  };

  const handleStart = async (): Promise<void> => {
    if (!selectedQuestion) return;
    if (currentDraft.finalCount === null) {
      setError("최종 응답 수는 1 이상의 정수여야 합니다.");
      return;
    }
    const meanTarget = currentDraft.targets.find(
      (target) => target.kind === "mean" && target.questionId === selectedQuestion.id,
    );
    if (!meanTarget || meanTarget.intent === null) {
      setError("목표 평균은 유한한 숫자여야 합니다.");
      return;
    }
    if (sourceScope.kind === "submitted_between" && (!sourceScope.start || !sourceScope.end)) {
      setError("시간 범위를 사용할 때는 시작과 종료 timestamp가 모두 필요합니다.");
      return;
    }
    if (useShare) {
      const shareTarget = currentDraft.targets.find(
        (target) =>
          target.kind === "share" &&
          target.subject.kind === "value_group" &&
          target.subject.valueGroupId === shareGroupId,
      );
      if (!shareGroupId || !shareTarget || shareTarget.intent === null) {
        setError("share target은 ValueGroup과 유효한 목표값이 필요합니다.");
        return;
      }
    }
    if (
      useConditional &&
      (!conditionalGroupId || !selectedConditionalQuestion || conditionalDrafts.length === 0)
    ) {
      setError(
        "조건부 share는 Population ValueGroup, checkbox 질문, 하나 이상의 옵션이 필요합니다.",
      );
      return;
    }

    const nextOperationId = `synthesis-${Date.now()}`;
    setOperationId(nextOperationId);
    setResult(null);
    setRun(null);
    setExportMessage(null);
    setError(null);
    try {
      setDraftStatus("실행 전 저장 중…");
      await saveTargetDraft(currentDraft);
      setDraftStatus("저장 완료 · 실행 중");
      const next = await startTargetDraft(project.id, nextOperationId);
      setResult(next);
      setDraftStatus("자동 저장됨");
      if (next.status === "success") setRun(await getRun(next.runId));
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setOperationId(null);
    }
  };

  const handleResolveEditPlan = async (choice: "append_only" | "replacement"): Promise<void> => {
    if (result?.status !== "approval_required") return;
    setPlanBusy(true);
    setError(null);
    try {
      const resolved = await resolveSynthesisEditPlan(result.planId, choice);
      setResult(resolved);
      setRun(await getRun(resolved.runId));
      setExportMessage(null);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setPlanBusy(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!operationId) return;
    try {
      await cancelSynthesis(operationId);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  };

  const handleExport = async (format: "csv" | "xlsx"): Promise<void> => {
    if (result?.status !== "success") return;
    setExportBusy(true);
    setExportMessage(null);
    setError(null);
    try {
      const exported = await exportRun(result.runId, format);
      setExportMessage(
        exported.status === "saved"
          ? `${format.toUpperCase()} 저장 완료`
          : `${format.toUpperCase()} 저장 취소`,
      );
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setExportBusy(false);
    }
  };

  const shareBaseline = profile?.metrics.find(
    (metric) =>
      metric.kind === "subject" &&
      metric.subject.kind === "value_group" &&
      metric.subject.valueGroupId === shareGroupId,
  );
  const meanBaseline = profile?.metrics.find(
    (metric) => metric.kind === "mean" && metric.questionId === questionId,
  );

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
      {groupable.length > 0 ? (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>ValueGroup</p>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              그룹화할 질문 (single-choice / text)
              <select
                value={groupQuestionId}
                onChange={(event) => {
                  setGroupQuestionId(event.target.value);
                  setGroupValueQuery("");
                  setGroupMembers([]);
                }}
                disabled={groupBusy}
              >
                {groupable.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.title} · {question.kind === "text" ? "text" : "single-choice"}
                  </option>
                ))}
              </select>
            </label>
            <input
              placeholder="값 검색"
              value={groupValueQuery}
              onChange={(event) => setGroupValueQuery(event.target.value)}
              disabled={groupBusy}
            />
            <div style={{ display: "grid", gap: 4 }}>
              {filteredGroupValues.map((value) => (
                <label key={value.value} style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={groupMembers.includes(value.value)}
                    disabled={groupBusy}
                    onChange={(event) =>
                      setGroupMembers((current) =>
                        event.target.checked
                          ? [...current, value.value]
                          : current.filter((member) => member !== value.value),
                      )
                    }
                  />{" "}
                  {value.label} · 원본 {value.count}개
                </label>
              ))}
            </div>
            <input
              placeholder="그룹 이름"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              disabled={groupBusy}
            />
            <button type="button" disabled={groupBusy} onClick={() => void handleCreateGroup()}>
              ValueGroup 저장
            </button>
          </div>
          {groups.length > 0 ? (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {groups.map((group) => (
                <div
                  key={group.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}
                >
                  <span>
                    {group.name} · 멤버 {group.members.length}개
                  </span>
                  <button
                    type="button"
                    disabled={groupBusy}
                    onClick={() => void handleDeleteGroup(group)}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {ordinal.length === 0 ? (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            ordinal 질문이 없어 mean target을 실행할 수 없습니다.
          </p>
        </section>
      ) : (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            최종 N + targets + 승인형 original replacement
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12 }}>
            SourceScope {profile ? `${profile.responseCount}개 응답` : "계산 중…"}
            {draftStatus ? ` · ${draftStatus}` : ""}
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              평균을 맞출 점수 질문
              <select
                value={questionId}
                onChange={(event) => setQuestionId(event.target.value)}
                disabled={operationId !== null}
              >
                {ordinal.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.title} ({question.min}–{question.max})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              최종 응답 수
              <input
                value={finalCount}
                onChange={(event) => setFinalCount(event.target.value)}
                disabled={operationId !== null}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              최종 평균
              <input
                value={targetMean}
                onChange={(event) => setTargetMean(event.target.value)}
                disabled={operationId !== null}
              />
              {meanBaseline?.kind === "mean" ? (
                <span>
                  현재 {meanBaseline.mean.toFixed(3)} · 응답 {meanBaseline.denominatorCount}개
                </span>
              ) : null}
            </label>

            {groups.length > 0 ? (
              <>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={useShare}
                    onChange={(event) => setUseShare(event.target.checked)}
                    disabled={operationId !== null}
                  />{" "}
                  ValueGroup 전체 비중 target 사용
                </label>
                {useShare ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <select
                      value={shareGroupId}
                      onChange={(event) => setShareGroupId(event.target.value)}
                      disabled={operationId !== null}
                    >
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={shareIntentKind}
                      onChange={(event) =>
                        setShareIntentKind(event.target.value as ShareIntentKind)
                      }
                      disabled={operationId !== null}
                    >
                      <option value="absolute">최종 비율</option>
                      <option value="percentage_point_delta">현재값에서 %p 증감</option>
                      <option value="relative_percent_delta">현재값 대비 % 증감</option>
                    </select>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      {shareIntentLabel(shareIntentKind)}
                      <input
                        value={targetSharePercent}
                        onChange={(event) => setTargetSharePercent(event.target.value)}
                        disabled={operationId !== null}
                      />
                      {shareBaseline?.kind === "subject" ? (
                        <span>
                          현재 {(shareBaseline.share * 100).toFixed(2)}% · {shareBaseline.count}/
                          {shareBaseline.denominatorCount}
                        </span>
                      ) : null}
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}

            {groups.length > 0 && checkbox.length > 0 ? (
              <>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={useConditional}
                    onChange={(event) => setUseConditional(event.target.checked)}
                    disabled={operationId !== null}
                  />{" "}
                  ValueGroup 내부 checkbox 조건부 share target 사용
                </label>
                {useConditional ? (
                  <div style={{ display: "grid", gap: 8, paddingLeft: 12 }}>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      Population ValueGroup (분모)
                      <select
                        value={conditionalGroupId}
                        onChange={(event) => setConditionalGroupId(event.target.value)}
                        disabled={operationId !== null}
                      >
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      checkbox 질문
                      <select
                        value={conditionalQuestionId}
                        onChange={(event) => {
                          setConditionalQuestionId(event.target.value);
                          setConditionalDrafts([]);
                        }}
                        disabled={operationId !== null}
                      >
                        {checkbox.map((question) => (
                          <option key={question.id} value={question.id}>
                            {question.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: "grid", gap: 6 }}>
                      {selectedConditionalQuestion?.options.map((option) => {
                        const draft = conditionalDrafts.find(
                          (candidate) => candidate.optionKey === option.key,
                        );
                        return (
                          <div
                            key={option.key}
                            style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}
                          >
                            <label style={{ fontSize: 12 }}>
                              <input
                                type="checkbox"
                                checked={draft !== undefined}
                                onChange={(event) =>
                                  toggleConditionalOption(option.key, event.target.checked)
                                }
                                disabled={operationId !== null}
                              />{" "}
                              {option.label}
                            </label>
                            <input
                              aria-label={`${option.label} 조건부 share`}
                              value={draft?.percent ?? ""}
                              placeholder="%"
                              disabled={draft === undefined || operationId !== null}
                              onChange={(event) =>
                                updateConditionalPercent(option.key, event.target.value)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={useRange}
                onChange={(event) => setUseRange(event.target.checked)}
                disabled={operationId !== null}
              />{" "}
              제출 timestamp 범위로 SourceScope 제한
            </label>
            {useRange ? (
              <div style={{ display: "grid", gap: 6 }}>
                <input
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  disabled={operationId !== null}
                />
                <input
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  disabled={operationId !== null}
                />
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              disabled={operationId !== null || !draftReady}
              onClick={() => void handleStart()}
            >
              {operationId ? "합성 중…" : "합성 실행"}
            </button>
            {operationId ? (
              <button type="button" onClick={() => void handleCancel()}>
                취소
              </button>
            ) : null}
          </div>

          {result?.status === "approval_required" ? (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 10,
                padding: 10,
                border: "1px solid currentColor",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                목표를 더 가깝게 맞추려면 원본-derived 행 {result.editPlan.replacementCount}개를
                최종 결과에서 교체해야 합니다. 원본 import 자체는 변경되지 않습니다.
              </p>
              <EditPlanOutcomeView
                label="원본 유지 (append-only)"
                outcome={result.editPlan.appendOnlyOutcome}
              />
              <EditPlanOutcomeView
                label={`교체 적용 (${result.editPlan.replacementCount}개)`}
                outcome={result.editPlan.replacementOutcome}
              />
              <div style={{ display: "grid", gap: 3 }}>
                {result.editPlan.proposedReplacements.map((replacement) => (
                  <span
                    key={`${replacement.sourceResponseId}:${replacement.replacementResponseId}`}
                  >
                    {replacement.sourceResponseId} → {replacement.replacementResponseId}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={planBusy}
                  onClick={() => void handleResolveEditPlan("append_only")}
                >
                  원본 유지 결과 사용
                </button>
                <button
                  type="button"
                  disabled={planBusy}
                  onClick={() => void handleResolveEditPlan("replacement")}
                >
                  {planBusy ? "처리 중…" : "교체 계획 승인"}
                </button>
              </div>
            </div>
          ) : null}

          {result?.status === "success" ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <p style={{ margin: 0 }}>Run {result.runId}</p>
              <p style={{ margin: "4px 0 0" }}>
                합성 {result.syntheticResponseCount}개 · 최종 {result.finalResponseCount}개
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={() => void handleExport("csv")}
                >
                  {exportBusy ? "저장 중…" : "CSV 내보내기"}
                </button>
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={() => void handleExport("xlsx")}
                >
                  {exportBusy ? "저장 중…" : "XLSX 내보내기"}
                </button>
                {exportMessage ? <span role="status">{exportMessage}</span> : null}
              </div>
              {run ? (
                <>
                  {currentQualityScore === undefined ? null : (
                    <p style={{ margin: "4px 0 0" }}>SDMetrics {currentQualityScore.toFixed(4)}</p>
                  )}
                  {run.targetSnapshot.editPlan ? (
                    <p style={{ margin: "4px 0 0" }}>
                      승인된 original replacement {run.targetSnapshot.editPlan.replacementCount}개
                    </p>
                  ) : null}
                  {targetOutcomes.map((outcome) => (
                    <p key={String(outcome.targetId)} style={{ margin: "4px 0 0" }}>
                      {frozenTargetLabel(run, outcome, checkbox)} · {outcomeLabel(outcome)}
                    </p>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          {result?.status === "infeasible" ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {result.issues.map((issue) => (
                <p
                  key={`${issue.code}:${issue.targetIds.join(",")}:${issue.message}`}
                  style={{ margin: "4px 0 0" }}
                >
                  {issue.code} [{issue.targetIds.join(", ")}]: {issue.message}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
