import { useEffect, useMemo, useState } from "react";

import type {
  EditPlanTargetOutcome,
  ProjectDetailView,
  RunsGetResult,
  SourceScope,
  SynthesisStartParams,
  SynthesisStartResult,
  TargetId,
  TargetOutcome,
  ValueGroupObservedValue,
  ValueGroupView,
} from "@survey-synth/contracts";

import {
  cancelSynthesis,
  createValueGroup,
  deleteValueGroup,
  exportRun,
  getRun,
  listValueGroups,
  listValueGroupValues,
  resolveSynthesisEditPlan,
  startSynthesis,
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
    return [{ id: question.id, title: questionTitle(question), min: question.min, max: question.max }];
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
  const requested = outcome.kind === "share" || outcome.kind === "conditional_share"
    ? `${(outcome.requested * 100).toFixed(2)}%`
    : outcome.requested.toFixed(4);
  const achieved = outcome.kind === "share" || outcome.kind === "conditional_share"
    ? `${(outcome.achieved * 100).toFixed(2)}%`
    : outcome.achieved.toFixed(4);
  const counts =
    outcome.numeratorCount === undefined
      ? ""
      : ` · ${outcome.numeratorCount}/${outcome.denominatorCount ?? "?"}`;
  return `${String(outcome.targetId)} · ${outcome.kind} · 요청 ${requested} · 달성 ${achieved}${counts} · ${outcome.exact ? "exact" : "nearest"}`;
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

const achievedTargets = (run: RunsGetResult | null): TargetOutcome[] => {
  if (!run) return [];
  const achieved = asRecord(run.validation.achieved);
  if (!achieved) return [];
  if (Array.isArray(achieved.targets)) {
    return achieved.targets.flatMap((value) => {
      const item = asRecord(value);
      if (
        !item ||
        typeof item.targetId !== "string" ||
        !["count", "share", "mean", "conditional_share"].includes(String(item.kind)) ||
        typeof item.requested !== "number" ||
        typeof item.achieved !== "number" ||
        typeof item.absoluteError !== "number" ||
        typeof item.exact !== "boolean"
      ) {
        return [];
      }
      return [
        {
          targetId: targetId(item.targetId),
          kind: item.kind as TargetOutcome["kind"],
          requested: item.requested,
          achieved: item.achieved,
          absoluteError: item.absoluteError,
          exact: item.exact,
          ...(typeof item.numeratorCount === "number" ? { numeratorCount: item.numeratorCount } : {}),
          ...(typeof item.denominatorCount === "number" ? { denominatorCount: item.denominatorCount } : {}),
        },
      ];
    });
  }

  const frozen = run.targetSnapshot.targets;
  const results: TargetOutcome[] = [];
  const meanTarget = frozen.find((target) => target.kind === "mean");
  if (
    meanTarget?.kind === "mean" &&
    typeof achieved.mean === "number" &&
    typeof achieved.absoluteError === "number" &&
    typeof achieved.exact === "boolean"
  ) {
    results.push({
      targetId: meanTarget.id,
      kind: "mean",
      requested: meanTarget.value,
      achieved: achieved.mean,
      absoluteError: achieved.absoluteError,
      exact: achieved.exact,
    });
  }
  const shares = Array.isArray(achieved.shares) ? achieved.shares.map(asRecord) : [];
  for (const share of shares) {
    if (!share || typeof share.id !== "string" || typeof share.share !== "number") continue;
    const target = frozen.find(
      (candidate) => candidate.kind === "share" && String(candidate.id) === share.id,
    );
    if (target?.kind !== "share" || typeof share.absoluteError !== "number") continue;
    results.push({
      targetId: target.id,
      kind: "share",
      requested: target.value,
      achieved: share.share,
      absoluteError: share.absoluteError,
      exact: typeof share.exact === "boolean" ? share.exact : share.absoluteError <= 1e-9,
    });
  }
  const conditionals = Array.isArray(achieved.conditionalShares)
    ? achieved.conditionalShares.map(asRecord)
    : [];
  for (const conditional of conditionals) {
    if (!conditional || typeof conditional.id !== "string" || typeof conditional.share !== "number") {
      continue;
    }
    const target = frozen.find(
      (candidate) =>
        candidate.kind === "conditional_share" && String(candidate.id) === conditional.id,
    );
    if (target?.kind !== "conditional_share" || typeof conditional.absoluteError !== "number") {
      continue;
    }
    results.push({
      targetId: target.id,
      kind: "conditional_share",
      requested: target.value,
      achieved: conditional.share,
      absoluteError: conditional.absoluteError,
      exact:
        typeof conditional.exact === "boolean"
          ? conditional.exact
          : conditional.absoluteError <= 1e-9,
      ...(typeof conditional.numeratorCount === "number"
        ? { numeratorCount: conditional.numeratorCount }
        : {}),
      ...(typeof conditional.denominatorCount === "number"
        ? { denominatorCount: conditional.denominatorCount }
        : {}),
    });
  }
  return results;
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
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [useShare, setUseShare] = useState(false);
  const [shareGroupId, setShareGroupId] = useState("");
  const [targetSharePercent, setTargetSharePercent] = useState("35");
  const [useConditional, setUseConditional] = useState(false);
  const [conditionalGroupId, setConditionalGroupId] = useState("");
  const [conditionalQuestionId, setConditionalQuestionId] = useState("");
  const [conditionalDrafts, setConditionalDrafts] = useState<ConditionalDraft[]>([]);
  const [operationId, setOperationId] = useState<string | null>(null);
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
    setQuestionId(ordinal[0]?.id ?? "");
    setGroupQuestionId(groupable[0]?.id ?? "");
    setConditionalQuestionId(checkbox[0]?.id ?? "");
    setResult(null);
    setRun(null);
    setError(null);
    void reloadGroups().catch((cause: unknown) => setError(errorMessage(cause)));
  }, [project.id, project.currentSourceRevisionId]);

  useEffect(() => {
    if (!groupQuestionId) {
      setGroupValues([]);
      return;
    }
    void listValueGroupValues(project.id, groupQuestionId)
      .then(setGroupValues)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, [project.id, groupQuestionId]);

  const selectedQuestion = ordinal.find((question) => question.id === questionId) ?? null;
  const selectedConditionalQuestion =
    checkbox.find((question) => question.id === conditionalQuestionId) ?? null;
  const targetOutcomes = achievedTargets(run);

  const handleCreateGroup = async (): Promise<void> => {
    if (!groupQuestionId || !groupName.trim() || groupMembers.length === 0) {
      setError("ValueGroup 이름과 하나 이상의 멤버가 필요합니다.");
      return;
    }
    try {
      await createValueGroup({
        projectId: project.id,
        questionId: groupQuestionId,
        name: groupName.trim(),
        members: groupMembers,
      });
      setGroupName("");
      setGroupMembers([]);
      await reloadGroups();
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  };

  const handleStart = async (): Promise<void> => {
    if (!selectedQuestion) return;
    const parsedFinalCount = Number(finalCount);
    const parsedMean = Number(targetMean);
    if (!Number.isInteger(parsedFinalCount) || parsedFinalCount <= 0 || !Number.isFinite(parsedMean)) {
      setError("최종 응답 수와 평균 목표를 확인해 주세요.");
      return;
    }
    const sourceScope: SourceScope = useRange
      ? { kind: "submitted_between", start: rangeStart.trim(), end: rangeEnd.trim() }
      : { kind: "all" };
    if (sourceScope.kind === "submitted_between" && (!sourceScope.start || !sourceScope.end)) {
      setError("시간 범위를 사용할 때는 시작과 종료 timestamp가 모두 필요합니다.");
      return;
    }

    const targets: SynthesisStartParams["targets"] = [
      {
        id: targetId(`mean:${selectedQuestion.id}`),
        kind: "mean",
        questionId: selectedQuestion.id,
        value: parsedMean,
      },
    ];
    if (useShare) {
      const value = Number(targetSharePercent) / 100;
      if (!shareGroupId || !Number.isFinite(value) || value < 0 || value > 1) {
        setError("share target은 ValueGroup과 0–100 사이의 비율이 필요합니다.");
        return;
      }
      targets.push({
        id: targetId(`share:value-group:${shareGroupId}`),
        kind: "share",
        subject: { kind: "value_group", valueGroupId: shareGroupId },
        value,
      });
    }
    if (useConditional) {
      if (!conditionalGroupId || !selectedConditionalQuestion || conditionalDrafts.length === 0) {
        setError("조건부 share는 Population ValueGroup, checkbox 질문, 옵션이 필요합니다.");
        return;
      }
      for (const draft of conditionalDrafts) {
        const value = Number(draft.percent) / 100;
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          setError("조건부 share 비율은 0–100 사이여야 합니다.");
          return;
        }
        targets.push({
          id: targetId(
            `conditional:${conditionalGroupId}:${selectedConditionalQuestion.id}:${draft.optionKey}`,
          ),
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: conditionalGroupId },
          questionId: selectedConditionalQuestion.id,
          optionKey: draft.optionKey,
          value,
        });
      }
    }

    const nextOperationId = `synthesis-${Date.now()}`;
    setOperationId(nextOperationId);
    setResult(null);
    setRun(null);
    setError(null);
    try {
      const next = await startSynthesis({
        projectId: project.id,
        finalCount: parsedFinalCount,
        targets,
        sourceScope,
        seed: 42,
        operationId: nextOperationId,
      });
      setResult(next);
      if (next.status === "success") setRun(await getRun(next.runId));
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setOperationId(null);
    }
  };

  const resolvePlan = async (choice: "append_only" | "replacement"): Promise<void> => {
    if (result?.status !== "approval_required") return;
    try {
      const resolved = await resolveSynthesisEditPlan(result.planId, choice);
      setResult(resolved);
      setRun(await getRun(resolved.runId));
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
      {groupable.length > 0 ? (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <strong>ValueGroup</strong>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <select value={groupQuestionId} onChange={(event) => setGroupQuestionId(event.target.value)}>
              {groupable.map((question) => (
                <option key={question.id} value={question.id}>{question.title}</option>
              ))}
            </select>
            <div style={{ display: "grid", gap: 4 }}>
              {groupValues.map((value) => (
                <label key={value.value} style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={groupMembers.includes(value.value)}
                    onChange={(event) =>
                      setGroupMembers((current) =>
                        event.target.checked
                          ? [...current, value.value]
                          : current.filter((member) => member !== value.value),
                      )
                    }
                  />{" "}
                  {value.label} · {value.count}
                </label>
              ))}
            </div>
            <input value={groupName} placeholder="그룹 이름" onChange={(event) => setGroupName(event.target.value)} />
            <button type="button" onClick={() => void handleCreateGroup()}>ValueGroup 저장</button>
            {groups.map((group) => (
              <div key={group.id} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <span>{group.name}</span>
                <button
                  type="button"
                  onClick={() => void deleteValueGroup(group.id).then(reloadGroups).catch((cause: unknown) => setError(errorMessage(cause)))}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedQuestion ? (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <strong>합성 targets</strong>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <select value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
              {ordinal.map((question) => (
                <option key={question.id} value={question.id}>{question.title} ({question.min}–{question.max})</option>
              ))}
            </select>
            <input value={finalCount} onChange={(event) => setFinalCount(event.target.value)} placeholder="최종 응답 수" />
            <input value={targetMean} onChange={(event) => setTargetMean(event.target.value)} placeholder="최종 평균" />

            {groups.length > 0 ? (
              <>
                <label><input type="checkbox" checked={useShare} onChange={(event) => setUseShare(event.target.checked)} /> ValueGroup 전체 비중 target 사용</label>
                {useShare ? (
                  <>
                    <select value={shareGroupId} onChange={(event) => setShareGroupId(event.target.value)}>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <input value={targetSharePercent} onChange={(event) => setTargetSharePercent(event.target.value)} placeholder="share %" />
                  </>
                ) : null}
              </>
            ) : null}

            {groups.length > 0 && checkbox.length > 0 ? (
              <>
                <label><input type="checkbox" checked={useConditional} onChange={(event) => setUseConditional(event.target.checked)} /> 조건부 checkbox share target 사용</label>
                {useConditional ? (
                  <>
                    <select value={conditionalGroupId} onChange={(event) => setConditionalGroupId(event.target.value)}>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <select value={conditionalQuestionId} onChange={(event) => { setConditionalQuestionId(event.target.value); setConditionalDrafts([]); }}>
                      {checkbox.map((question) => <option key={question.id} value={question.id}>{question.title}</option>)}
                    </select>
                    {selectedConditionalQuestion?.options.map((option) => {
                      const draft = conditionalDrafts.find((item) => item.optionKey === option.key);
                      return (
                        <div key={option.key} style={{ display: "flex", gap: 8 }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={draft !== undefined}
                              onChange={(event) => setConditionalDrafts((current) => event.target.checked ? [...current, { optionKey: option.key, percent: "50" }] : current.filter((item) => item.optionKey !== option.key))}
                            />{" "}{option.label}
                          </label>
                          <input
                            value={draft?.percent ?? ""}
                            disabled={!draft}
                            onChange={(event) => setConditionalDrafts((current) => current.map((item) => item.optionKey === option.key ? { ...item, percent: event.target.value } : item))}
                            placeholder="%"
                          />
                        </div>
                      );
                    })}
                  </>
                ) : null}
              </>
            ) : null}

            <label><input type="checkbox" checked={useRange} onChange={(event) => setUseRange(event.target.checked)} /> SourceScope timestamp 범위 사용</label>
            {useRange ? (
              <>
                <input value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                <input value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
              </>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={operationId !== null} onClick={() => void handleStart()}>{operationId ? "합성 중…" : "합성 실행"}</button>
              {operationId ? <button type="button" onClick={() => void cancelSynthesis(operationId)}>취소</button> : null}
            </div>
          </div>

          {result?.status === "approval_required" ? (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <EditPlanOutcomeView label="append-only" outcome={result.editPlan.appendOnlyOutcome} />
              <EditPlanOutcomeView label={`replacement (${result.editPlan.replacementCount})`} outcome={result.editPlan.replacementOutcome} />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void resolvePlan("append_only")}>원본 유지 결과 사용</button>
                <button type="button" onClick={() => void resolvePlan("replacement")}>교체 계획 승인</button>
              </div>
            </div>
          ) : null}

          {result?.status === "success" ? (
            <div style={{ display: "grid", gap: 4, marginTop: 12, fontSize: 12 }}>
              <span>Run {result.runId} · 최종 {result.finalResponseCount}</span>
              {targetOutcomes.map((outcome) => <span key={String(outcome.targetId)}>{outcomeLabel(outcome)}</span>)}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void exportRun(result.runId, "csv")}>CSV 내보내기</button>
                <button type="button" onClick={() => void exportRun(result.runId, "xlsx")}>XLSX 내보내기</button>
              </div>
            </div>
          ) : null}

          {result?.status === "infeasible" ? (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              {result.issues.map((item) => (
                <p key={`${item.code}:${item.targetIds.join(",")}`} style={{ margin: "4px 0" }}>
                  {item.code} [{item.targetIds.join(", ")}]: {item.message}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <p>ordinal 질문이 없어 현재 synthesis engine을 실행할 수 없습니다.</p>
      )}

      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
