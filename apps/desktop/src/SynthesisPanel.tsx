import { useEffect, useMemo, useState } from "react";

import type {
  ProjectDetailView,
  RunsGetResult,
  SourceScope,
  SynthesisStartResult,
  ValueGroupObservedValue,
  ValueGroupView,
} from "@survey-synth/contracts";

import {
  cancelSynthesis,
  createValueGroup,
  deleteValueGroup,
  getRun,
  listValueGroups,
  listValueGroupValues,
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

const conditionalTargetId = (
  valueGroupId: string,
  questionId: string,
  optionKey: string,
): string => `conditional:${valueGroupId}:${questionId}:${optionKey}`;

const achieved = (
  run: RunsGetResult | null,
): {
  mean: number;
  absoluteError: number;
  exact: boolean;
  shares: Array<{ id: string; share: number; absoluteError: number; exact: boolean }>;
  conditionalShares: Array<{
    id: string;
    share: number;
    numeratorCount: number;
    denominatorCount: number;
    absoluteError: number;
    exact: boolean;
  }>;
  qualityScore?: number;
} | null => {
  if (!run) return null;
  const achievedRecord = asRecord(run.validation.achieved);
  if (
    !achievedRecord ||
    typeof achievedRecord.mean !== "number" ||
    typeof achievedRecord.absoluteError !== "number" ||
    typeof achievedRecord.exact !== "boolean"
  ) {
    return null;
  }
  const shares = Array.isArray(achievedRecord.shares)
    ? achievedRecord.shares.flatMap((value) => {
        const item = asRecord(value);
        return item &&
          typeof item.id === "string" &&
          typeof item.share === "number" &&
          typeof item.absoluteError === "number" &&
          typeof item.exact === "boolean"
          ? [
              {
                id: item.id,
                share: item.share,
                absoluteError: item.absoluteError,
                exact: item.exact,
              },
            ]
          : [];
      })
    : [];
  const conditionalShares = Array.isArray(achievedRecord.conditionalShares)
    ? achievedRecord.conditionalShares.flatMap((value) => {
        const item = asRecord(value);
        return item &&
          typeof item.id === "string" &&
          typeof item.share === "number" &&
          typeof item.numeratorCount === "number" &&
          typeof item.denominatorCount === "number" &&
          typeof item.absoluteError === "number" &&
          typeof item.exact === "boolean"
          ? [
              {
                id: item.id,
                share: item.share,
                numeratorCount: item.numeratorCount,
                denominatorCount: item.denominatorCount,
                absoluteError: item.absoluteError,
                exact: item.exact,
              },
            ]
          : [];
      })
    : [];
  const quality = asRecord(run.validation.quality);
  const qualityScore = quality?.sdmetricsScore;
  return {
    mean: achievedRecord.mean,
    absoluteError: achievedRecord.absoluteError,
    exact: achievedRecord.exact,
    shares,
    conditionalShares,
    ...(typeof qualityScore === "number" ? { qualityScore } : {}),
  };
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
  const [targetSharePercent, setTargetSharePercent] = useState("35");
  const [useConditional, setUseConditional] = useState(false);
  const [conditionalGroupId, setConditionalGroupId] = useState("");
  const [conditionalQuestionId, setConditionalQuestionId] = useState("");
  const [conditionalDrafts, setConditionalDrafts] = useState<ConditionalDraft[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
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
    setTargetSharePercent("35");
    setUseConditional(false);
    setConditionalQuestionId(checkbox[0]?.id ?? "");
    setConditionalDrafts([]);
    setOperationId(null);
    setResult(null);
    setRun(null);
    setError(null);
    void reloadGroups().catch((cause: unknown) => setError(errorMessage(cause)));
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
  const metrics = achieved(run);
  const filteredGroupValues = useMemo(() => {
    const query = groupValueQuery.trim().toLocaleLowerCase();
    if (!query) return groupValues;
    return groupValues.filter(
      (value) =>
        value.label.toLocaleLowerCase().includes(query) ||
        value.value.toLocaleLowerCase().includes(query),
    );
  }, [groupValueQuery, groupValues]);

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
    const parsedFinalCount = Number(finalCount);
    const parsedMean = Number(targetMean);
    if (!Number.isInteger(parsedFinalCount) || parsedFinalCount <= 0) {
      setError("최종 응답 수는 1 이상의 정수여야 합니다.");
      return;
    }
    if (!Number.isFinite(parsedMean)) {
      setError("목표 평균은 유한한 숫자여야 합니다.");
      return;
    }

    const sourceScope: SourceScope = useRange
      ? { kind: "submitted_between", start: rangeStart.trim(), end: rangeEnd.trim() }
      : { kind: "all" };
    if (sourceScope.kind === "submitted_between" && (!sourceScope.start || !sourceScope.end)) {
      setError("시간 범위를 사용할 때는 시작과 종료 timestamp가 모두 필요합니다.");
      return;
    }

    const targets: Array<
      | { kind: "mean"; questionId: string; value: number }
      | { kind: "share"; valueGroupId: string; value: number }
      | {
          kind: "conditional_share";
          valueGroupId: string;
          questionId: string;
          optionKey: string;
          value: number;
        }
    > = [{ kind: "mean", questionId: selectedQuestion.id, value: parsedMean }];
    if (useShare) {
      const parsedShare = Number(targetSharePercent) / 100;
      if (!shareGroupId || !Number.isFinite(parsedShare) || parsedShare < 0 || parsedShare > 1) {
        setError("share target은 ValueGroup과 0–100 사이의 비율이 필요합니다.");
        return;
      }
      targets.push({ kind: "share", valueGroupId: shareGroupId, value: parsedShare });
    }

    if (useConditional) {
      if (!conditionalGroupId || !selectedConditionalQuestion || conditionalDrafts.length === 0) {
        setError("조건부 share는 Population ValueGroup, checkbox 질문, 하나 이상의 옵션이 필요합니다.");
        return;
      }
      for (const draft of conditionalDrafts) {
        const value = Number(draft.percent) / 100;
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          setError("조건부 share 비율은 0–100 사이여야 합니다.");
          return;
        }
        targets.push({
          kind: "conditional_share",
          valueGroupId: conditionalGroupId,
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

  const handleCancel = async (): Promise<void> => {
    if (!operationId) return;
    try {
      await cancelSynthesis(operationId);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
      {groupable.length > 0 ? (
        <section style={{ padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>M5 · ValueGroup</p>
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
                  <span>{group.name} · 멤버 {group.members.length}개</span>
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
            M6 · 최종 N + mean + share + conditional checkbox share
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
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      최종 share (%)
                      <input
                        value={targetSharePercent}
                        onChange={(event) => setTargetSharePercent(event.target.value)}
                        disabled={operationId !== null}
                      />
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
                          <option key={group.id} value={group.id}>{group.name}</option>
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
                          <option key={question.id} value={question.id}>{question.title}</option>
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
            <button type="button" disabled={operationId !== null} onClick={() => void handleStart()}>
              {operationId ? "합성 중…" : "합성 실행"}
            </button>
            {operationId ? (
              <button type="button" onClick={() => void handleCancel()}>취소</button>
            ) : null}
          </div>

          {result?.status === "success" ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <p style={{ margin: 0 }}>Run {result.runId}</p>
              <p style={{ margin: "4px 0 0" }}>
                합성 {result.syntheticResponseCount}개 · 최종 {result.finalResponseCount}개
              </p>
              {metrics && run ? (
                <>
                  <p style={{ margin: "4px 0 0" }}>
                    달성 평균 {metrics.mean.toFixed(6)} · 오차 {metrics.absoluteError.toFixed(6)} ·{" "}
                    {metrics.exact ? "정확히 표현됨" : "가장 가까운 표현"}
                    {metrics.qualityScore === undefined
                      ? ""
                      : ` · SDMetrics ${metrics.qualityScore.toFixed(4)}`}
                  </p>
                  {metrics.shares.map((share) => {
                    const frozen = run.targetSnapshot.targets.find(
                      (target) => target.kind === "share" && target.valueGroup.id === share.id,
                    );
                    return (
                      <p key={share.id} style={{ margin: "4px 0 0" }}>
                        {frozen?.kind === "share" ? frozen.valueGroup.name : share.id} share{" "}
                        {(share.share * 100).toFixed(2)}% · 오차{" "}
                        {(share.absoluteError * 100).toFixed(2)}%p ·{" "}
                        {share.exact ? "정확히 표현됨" : "가장 가까운 표현"}
                      </p>
                    );
                  })}
                  {metrics.conditionalShares.map((share) => {
                    const frozen = run.targetSnapshot.targets.find(
                      (target) =>
                        target.kind === "conditional_share" &&
                        conditionalTargetId(
                          target.valueGroup.id,
                          target.questionId,
                          target.optionKey,
                        ) === share.id,
                    );
                    const question =
                      frozen?.kind === "conditional_share"
                        ? checkbox.find((candidate) => candidate.id === frozen.questionId)
                        : null;
                    const option =
                      frozen?.kind === "conditional_share"
                        ? question?.options.find((candidate) => candidate.key === frozen.optionKey)
                        : null;
                    const population =
                      frozen?.kind === "conditional_share" ? frozen.valueGroup.name : share.id;
                    return (
                      <p key={share.id} style={{ margin: "4px 0 0" }}>
                        {population} 중 {option?.label ?? "checkbox option"} ·{" "}
                        {share.numeratorCount}/{share.denominatorCount} ={" "}
                        {(share.share * 100).toFixed(2)}% · 오차{" "}
                        {(share.absoluteError * 100).toFixed(2)}%p ·{" "}
                        {share.exact ? "정확히 표현됨" : "가장 가까운 표현"}
                      </p>
                    );
                  })}
                </>
              ) : null}
            </div>
          ) : null}

          {result?.status === "infeasible" ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {result.issues.map((issue) => (
                <p key={`${issue.code}:${issue.message}`} style={{ margin: "4px 0 0" }}>
                  {issue.code}: {issue.message}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {error ? <p role="alert" style={{ margin: 0, fontSize: 12 }}>{error}</p> : null}
    </div>
  );
}
