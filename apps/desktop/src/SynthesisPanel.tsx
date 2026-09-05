import { useEffect, useMemo, useState } from "react";

import type {
  ProjectDetailView,
  RunsGetResult,
  SynthesisStartResult,
  TimestampRange,
} from "@survey-synth/contracts";
import type { ProjectTargets } from "@survey-synth/domain";

import { cancelSynthesis, getRun, startSynthesis } from "./api/backend";

type OrdinalQuestionView = {
  id: string;
  title: string;
  min: number;
  max: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const ordinalQuestions = (project: ProjectDetailView): OrdinalQuestionView[] => {
  const questions = Array.isArray(project.form.questions) ? project.form.questions : [];
  return questions.flatMap((value) => {
    const question = asRecord(value);
    if (
      !question ||
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
        title:
          typeof question.title === "string" && question.title.length > 0
            ? question.title
            : question.id,
        min: question.min,
        max: question.max,
      },
    ];
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "합성 요청을 처리하지 못했습니다.";

const achieved = (
  run: RunsGetResult | null,
): { mean: number; absoluteError: number; exact: boolean; qualityScore?: number } | null => {
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
  const quality = asRecord(run.validation.quality);
  const qualityScore = quality?.sdmetricsScore;
  return {
    mean: achievedRecord.mean,
    absoluteError: achievedRecord.absoluteError,
    exact: achievedRecord.exact,
    ...(typeof qualityScore === "number" ? { qualityScore } : {}),
  };
};

export function SynthesisPanel({ project }: { project: ProjectDetailView }) {
  const questions = useMemo(() => ordinalQuestions(project), [project]);
  const [questionId, setQuestionId] = useState("");
  const [finalCount, setFinalCount] = useState(String(project.responseCount + 40));
  const [targetMean, setTargetMean] = useState("4.7");
  const [useRange, setUseRange] = useState(false);
  const [rangeStart, setRangeStart] = useState(project.responseTimestampRange?.start ?? "");
  const [rangeEnd, setRangeEnd] = useState(project.responseTimestampRange?.end ?? "");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisStartResult | null>(null);
  const [run, setRun] = useState<RunsGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestionId(questions[0]?.id ?? "");
    setFinalCount(String(project.responseCount + 40));
    setTargetMean("4.7");
    setUseRange(false);
    setRangeStart(project.responseTimestampRange?.start ?? "");
    setRangeEnd(project.responseTimestampRange?.end ?? "");
    setOperationId(null);
    setResult(null);
    setRun(null);
    setError(null);
  }, [project.id, project.currentSourceRevisionId, project.responseCount, questions]);

  const selectedQuestion = questions.find((question) => question.id === questionId) ?? null;
  const metrics = achieved(run);

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

    const timestampRange: TimestampRange | undefined = useRange
      ? { start: rangeStart.trim(), end: rangeEnd.trim() }
      : undefined;
    if (timestampRange && (!timestampRange.start || !timestampRange.end)) {
      setError("시간 범위를 사용할 때는 시작과 종료 timestamp가 모두 필요합니다.");
      return;
    }

    const targets: ProjectTargets = {
      targetResponseCount: parsedFinalCount,
      questionTargets: [
        {
          kind: "mean",
          questionId: selectedQuestion.id as ProjectTargets["questionTargets"][number]["questionId"],
          target: { kind: "mean", value: parsedMean },
        },
      ],
    };
    const nextOperationId = `synthesis-${Date.now()}`;
    setOperationId(nextOperationId);
    setResult(null);
    setRun(null);
    setError(null);
    try {
      const next = await startSynthesis(
        project.id,
        targets,
        42,
        nextOperationId,
        undefined,
        undefined,
        timestampRange,
      );
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

  if (questions.length === 0) {
    return (
      <div style={{ marginTop: 12, padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>M4 합성: ordinal 질문이 없어 mean target을 실행할 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
      <p style={{ margin: 0, fontWeight: 600 }}>M4 · 최종 N + ordinal mean</p>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          질문
          <select value={questionId} onChange={(event) => setQuestionId(event.target.value)} disabled={operationId !== null}>
            {questions.map((question) => (
              <option key={question.id} value={question.id}>
                {question.title} ({question.min}–{question.max})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          최종 응답 수
          <input value={finalCount} onChange={(event) => setFinalCount(event.target.value)} disabled={operationId !== null} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          최종 평균
          <input value={targetMean} onChange={(event) => setTargetMean(event.target.value)} disabled={operationId !== null} />
        </label>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={useRange} onChange={(event) => setUseRange(event.target.checked)} disabled={operationId !== null} />{" "}
          제출 timestamp 범위로 SourceScope 제한
        </label>
        {useRange ? (
          <div style={{ display: "grid", gap: 6 }}>
            <input value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} disabled={operationId !== null} />
            <input value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} disabled={operationId !== null} />
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" disabled={operationId !== null} onClick={() => void handleStart()}>
          {operationId ? "합성 중…" : "합성 실행"}
        </button>
        {operationId ? (
          <button type="button" onClick={() => void handleCancel()}>
            취소
          </button>
        ) : null}
      </div>

      {result?.status === "success" ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <p style={{ margin: 0 }}>Run {result.runId}</p>
          <p style={{ margin: "4px 0 0" }}>
            합성 {result.syntheticResponseCount}개 · 최종 {result.finalResponseCount}개
          </p>
          {metrics ? (
            <p style={{ margin: "4px 0 0" }}>
              달성 평균 {metrics.mean.toFixed(6)} · 오차 {metrics.absoluteError.toFixed(6)} · {metrics.exact ? "정확히 표현됨" : "가장 가까운 표현"}
              {metrics.qualityScore === undefined ? "" : ` · SDMetrics ${metrics.qualityScore.toFixed(4)}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {result?.status === "infeasible" || result?.status === "unsupported" ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          {result.issues.map((issue) => (
            <p key={`${issue.code}:${issue.message}`} style={{ margin: "4px 0 0" }}>
              {issue.code}: {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 12 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
