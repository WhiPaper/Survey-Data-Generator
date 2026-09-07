import { useEffect, useMemo, useState } from "react";

import type {
  ProjectDetailView,
  TargetDraft,
  TargetDraftTarget,
  TargetId,
  TargetProfileMetric,
  TargetProfileResult,
} from "@survey-synth/contracts";

import { getTargetDraft, getTargetProfile, saveTargetDraft, startTargetDraft } from "./api/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type QuestionView = {
  id: string;
  title: string;
  kind: string;
  options: Array<{ key: string; label: string }>;
  min?: number;
  max?: number;
};

type TargetMode =
  | "absolute_share"
  | "percentage_point_delta"
  | "relative_percent_delta"
  | "absolute_count"
  | "count_delta";

type SubjectKind = "option" | "checkbox_option";

type EditingOption = {
  subjectKind: SubjectKind;
  questionId: string;
  questionTitle: string;
  optionKey: string;
  optionLabel: string;
};

type EditingMean = {
  questionId: string;
  questionTitle: string;
  min: number;
  max: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const projectQuestions = (project: ProjectDetailView): QuestionView[] => {
  const values = Array.isArray(project.form.questions) ? project.form.questions : [];
  return values.flatMap((value) => {
    const question = asRecord(value);
    if (!question || typeof question.id !== "string") return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((candidate) => {
          const option = asRecord(candidate);
          return option && typeof option.key === "string" && typeof option.label === "string"
            ? [{ key: option.key, label: option.label }]
            : [];
        })
      : [];
    return [
      {
        id: question.id,
        title: typeof question.title === "string" && question.title ? question.title : question.id,
        kind: typeof question.kind === "string" ? question.kind : "unknown",
        options,
        ...(typeof question.min === "number" ? { min: question.min } : {}),
        ...(typeof question.max === "number" ? { max: question.max } : {}),
      },
    ];
  });
};

const kindLabel = (kind: string): string => {
  if (kind === "single_choice") return "단일 선택";
  if (kind === "multi_choice") return "복수 선택";
  if (kind === "ordinal") return "점수";
  if (kind === "text") return "단답형";
  return "문항";
};

const questionIdForTarget = (target: TargetDraftTarget): string | null => {
  if (target.kind === "mean" || target.kind === "conditional_share") return target.questionId;
  return target.subject.kind === "value_group" ? null : target.subject.questionId;
};

const subjectTarget = (
  targets: readonly TargetDraftTarget[],
  subjectKind: SubjectKind,
  questionId: string,
  optionKey: string,
): TargetDraftTarget | undefined =>
  targets.find(
    (target) =>
      (target.kind === "share" || target.kind === "count") &&
      target.subject.kind === subjectKind &&
      target.subject.questionId === questionId &&
      target.subject.optionKey === optionKey,
  );

const subjectMetric = (
  profile: TargetProfileResult | null,
  subjectKind: SubjectKind,
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

const meanTarget = (
  targets: readonly TargetDraftTarget[],
  questionId: string,
): Extract<TargetDraftTarget, { kind: "mean" }> | undefined =>
  targets.find(
    (target): target is Extract<TargetDraftTarget, { kind: "mean" }> =>
      target.kind === "mean" && target.questionId === questionId,
  );

const meanMetric = (
  profile: TargetProfileResult | null,
  questionId: string,
): Extract<TargetProfileMetric, { kind: "mean" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "mean" }> =>
      metric.kind === "mean" && metric.questionId === questionId,
  );

const formatShare = (value: number): string => `${(value * 100).toFixed(1)}%`;

const targetModeFor = (target: TargetDraftTarget | undefined): TargetMode => {
  if (!target || (target.kind !== "share" && target.kind !== "count")) return "absolute_share";
  if (target.kind === "count") {
    return target.intent?.kind === "count_delta" ? "count_delta" : "absolute_count";
  }
  if (target.intent?.kind === "percentage_point_delta") return "percentage_point_delta";
  if (target.intent?.kind === "relative_percent_delta") return "relative_percent_delta";
  return "absolute_share";
};

const targetValueFor = (target: TargetDraftTarget | undefined): string => {
  if (!target || (target.kind !== "share" && target.kind !== "count") || !target.intent) return "";
  return target.kind === "share" ? String(target.intent.value * 100) : String(target.intent.value);
};

const targetSummary = (
  target: TargetDraftTarget | undefined,
  currentShare: number,
): string | null => {
  if (!target || (target.kind !== "share" && target.kind !== "count") || !target.intent)
    return null;
  if (target.kind === "count") {
    if (target.intent.kind === "count_delta") {
      return `${target.intent.value > 0 ? "+" : ""}${target.intent.value}명`;
    }
    return `최종 ${target.intent.value}명`;
  }
  if (target.intent.kind === "percentage_point_delta") {
    const delta = target.intent.value * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%p → ${formatShare(currentShare + target.intent.value)}`;
  }
  if (target.intent.kind === "relative_percent_delta") {
    const delta = target.intent.value * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% → ${formatShare(currentShare * (1 + target.intent.value))}`;
  }
  return `→ ${formatShare(target.intent.value)}`;
};

const subjectTargetId = (
  kind: "share" | "count",
  subjectKind: SubjectKind,
  questionId: string,
  optionKey: string,
): TargetId => `${kind}:${subjectKind}:${questionId}:${optionKey}` as TargetId;

const meanTargetId = (questionId: string): TargetId => `mean:${questionId}` as TargetId;

export function QuestionExplorerPanel({ project }: { project: ProjectDetailView }) {
  const questions = useMemo(() => projectQuestions(project), [project]);
  const [selectedQuestionId, setSelectedQuestionId] = useState(questions[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [targetOnly, setTargetOnly] = useState(false);
  const [draft, setDraft] = useState<TargetDraft>({
    projectId: project.id,
    finalCount: project.responseCount + 40,
    sourceScope: { kind: "all" },
    seed: 42,
    targets: [],
  });
  const [profile, setProfile] = useState<TargetProfileResult | null>(null);
  const [editing, setEditing] = useState<EditingOption | null>(null);
  const [editingMean, setEditingMean] = useState<EditingMean | null>(null);
  const [mode, setMode] = useState<TargetMode>("absolute_share");
  const [value, setValue] = useState("");
  const [meanValue, setMeanValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedQuestionId(questions[0]?.id ?? "");
  }, [project.id, questions]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    void getTargetDraft(project.id)
      .then(async (saved) => {
        if (!active) return;
        const nextDraft: TargetDraft = saved
          ? {
              projectId: saved.projectId,
              finalCount: saved.finalCount,
              sourceScope: saved.sourceScope,
              seed: saved.seed,
              targets: saved.targets,
            }
          : {
              projectId: project.id,
              finalCount: project.responseCount + 40,
              sourceScope: { kind: "all" },
              seed: 42,
              targets: [],
            };
        setDraft(nextDraft);
        setProfile(await getTargetProfile(project.id, nextDraft.sourceScope));
        if (active) setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "설정을 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [project.id, project.currentSourceRevisionId, project.responseCount]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void saveTargetDraft(draft).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "변경사항을 저장하지 못했습니다.");
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, loaded]);

  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ?? questions[0];
  const targetCountFor = (questionId: string): number =>
    draft.targets.filter((target) => questionIdForTarget(target) === questionId).length;
  const filteredQuestions = questions.filter((question) => {
    const matchesSearch = question.title
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
    return matchesSearch && (!targetOnly || targetCountFor(question.id) > 0);
  });
  const sourceCount = profile?.responseCount ?? project.responseCount;
  const finalCount = draft.finalCount;
  const finalCountInvalid = finalCount === null || finalCount < sourceCount;
  const additions = finalCountInvalid || finalCount === null ? null : finalCount - sourceCount;
  const currentMetric = editing
    ? subjectMetric(profile, editing.subjectKind, editing.questionId, editing.optionKey)
    : undefined;
  const existingEditingTarget = editing
    ? subjectTarget(draft.targets, editing.subjectKind, editing.questionId, editing.optionKey)
    : undefined;
  const currentMeanMetric = editingMean ? meanMetric(profile, editingMean.questionId) : undefined;
  const existingMeanTarget = editingMean ? meanTarget(draft.targets, editingMean.questionId) : undefined;
  const parsed = Number(value);
  const parsedMean = Number(meanValue);
  const isShareMode =
    mode === "absolute_share" ||
    mode === "percentage_point_delta" ||
    mode === "relative_percent_delta";
  const resolvedShare =
    currentMetric && Number.isFinite(parsed)
      ? mode === "absolute_share"
        ? parsed / 100
        : mode === "percentage_point_delta"
          ? currentMetric.share + parsed / 100
          : mode === "relative_percent_delta"
            ? currentMetric.share * (1 + parsed / 100)
            : null
      : null;
  const valueInvalid =
    value === "" ||
    !Number.isFinite(parsed) ||
    (isShareMode && (resolvedShare === null || resolvedShare < 0 || resolvedShare > 1)) ||
    (mode === "absolute_count" &&
      (!Number.isInteger(parsed) || parsed < 0 || (finalCount !== null && parsed > finalCount))) ||
    (mode === "count_delta" &&
      (!Number.isInteger(parsed) ||
        (currentMetric !== undefined && currentMetric.count + parsed < 0) ||
        (currentMetric !== undefined &&
          finalCount !== null &&
          currentMetric.count + parsed > finalCount)));
  const meanValueInvalid =
    !editingMean ||
    meanValue === "" ||
    !Number.isFinite(parsedMean) ||
    parsedMean < editingMean.min ||
    parsedMean > editingMean.max;

  const openTarget = (
    question: QuestionView,
    subjectKind: SubjectKind,
    optionKey: string,
    optionLabel: string,
  ) => {
    const existing = subjectTarget(draft.targets, subjectKind, question.id, optionKey);
    setEditing({
      subjectKind,
      questionId: question.id,
      questionTitle: question.title,
      optionKey,
      optionLabel,
    });
    setMode(targetModeFor(existing));
    setValue(targetValueFor(existing));
  };

  const commitTarget = () => {
    if (!editing || valueInvalid) return;
    const kind = mode === "absolute_count" || mode === "count_delta" ? "count" : "share";
    const normalized = kind === "share" ? parsed / 100 : Math.trunc(parsed);
    const intent =
      mode === "percentage_point_delta"
        ? ({ kind: "percentage_point_delta", value: normalized } as const)
        : mode === "relative_percent_delta"
          ? ({ kind: "relative_percent_delta", value: normalized } as const)
          : mode === "count_delta"
            ? ({ kind: "count_delta", value: normalized } as const)
            : ({ kind: "absolute", value: normalized } as const);
    const subject =
      editing.subjectKind === "option"
        ? ({ kind: "option", questionId: editing.questionId, optionKey: editing.optionKey } as const)
        : ({
            kind: "checkbox_option",
            questionId: editing.questionId,
            optionKey: editing.optionKey,
          } as const);
    const next: TargetDraftTarget = {
      id: subjectTargetId(kind, editing.subjectKind, editing.questionId, editing.optionKey),
      kind,
      subject,
      intent,
    };
    setDraft((current) => ({
      ...current,
      targets: [
        ...current.targets.filter(
          (target) =>
            !(
              (target.kind === "share" || target.kind === "count") &&
              target.subject.kind === editing.subjectKind &&
              target.subject.kind !== "value_group" &&
              target.subject.questionId === editing.questionId &&
              target.subject.optionKey === editing.optionKey
            ),
        ),
        next,
      ],
    }));
    setEditing(null);
  };

  const removeTarget = () => {
    if (!editing) return;
    setDraft((current) => ({
      ...current,
      targets: current.targets.filter(
        (target) =>
          !(
            (target.kind === "share" || target.kind === "count") &&
            target.subject.kind === editing.subjectKind &&
            target.subject.kind !== "value_group" &&
            target.subject.questionId === editing.questionId &&
            target.subject.optionKey === editing.optionKey
          ),
      ),
    }));
    setEditing(null);
  };

  const openMeanTarget = (question: QuestionView) => {
    if (question.min === undefined || question.max === undefined) return;
    const existing = meanTarget(draft.targets, question.id);
    setEditingMean({
      questionId: question.id,
      questionTitle: question.title,
      min: question.min,
      max: question.max,
    });
    setMeanValue(existing?.intent ? String(existing.intent.value) : "");
  };

  const commitMeanTarget = () => {
    if (!editingMean || meanValueInvalid) return;
    const next: TargetDraftTarget = {
      id: meanTargetId(editingMean.questionId),
      kind: "mean",
      questionId: editingMean.questionId,
      intent: { kind: "absolute", value: parsedMean },
    };
    setDraft((current) => ({
      ...current,
      targets: [
        ...current.targets.filter(
          (target) => !(target.kind === "mean" && target.questionId === editingMean.questionId),
        ),
        next,
      ],
    }));
    setEditingMean(null);
  };

  const removeMeanTarget = () => {
    if (!editingMean) return;
    setDraft((current) => ({
      ...current,
      targets: current.targets.filter(
        (target) => !(target.kind === "mean" && target.questionId === editingMean.questionId),
      ),
    }));
    setEditingMean(null);
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await saveTargetDraft(draft);
      const result = await startTargetDraft(project.id, `ui-generate-${Date.now()}`);
      if (result.status === "success") {
        setMessage(`최종 응답 ${result.finalResponseCount}개를 생성했습니다.`);
      } else if (result.status === "approval_required") {
        setMessage(`원본 응답 ${result.editPlan.replacementCount}개 대체 여부를 확인해야 합니다.`);
      } else {
        setMessage(`확인할 목표가 ${result.issues.length}개 있습니다.`);
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "응답을 생성하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded && !error) {
    return <p className="mt-4 text-sm text-muted-foreground">분포를 불러오는 중…</p>;
  }

  const renderChoiceRows = (question: QuestionView, subjectKind: SubjectKind) => (
    <div className="mt-7 space-y-1">
      {question.options.map((option) => {
        const metric = subjectMetric(profile, subjectKind, question.id, option.key);
        const currentShare = metric?.share ?? 0;
        const target = subjectTarget(draft.targets, subjectKind, question.id, option.key);
        const summary = targetSummary(target, currentShare);
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => openTarget(question, subjectKind, option.key, option.label)}
            className="group grid w-full grid-cols-[minmax(140px,1fr)_72px_72px_minmax(120px,1.2fr)_120px] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted/60"
          >
            <span className="truncate font-medium">{option.label}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {metric?.count ?? 0}명
            </span>
            <span className="text-right tabular-nums">{formatShare(currentShare)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground/45"
                style={{ width: `${Math.max(0, Math.min(100, currentShare * 100))}%` }}
              />
            </span>
            <span
              className={`text-right tabular-nums ${summary ? "font-medium" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
            >
              {summary ?? "+ 목표"}
            </span>
          </button>
        );
      })}
    </div>
  );

  const selectedCheckboxDenominator =
    selectedQuestion?.kind === "multi_choice"
      ? selectedQuestion.options
          .map((option) => subjectMetric(profile, "checkbox_option", selectedQuestion.id, option.key))
          .find((metric) => metric !== undefined)?.denominatorCount
      : undefined;

  return (
    <section className="mt-4 overflow-hidden rounded-lg border bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">원본</span>
          <span className="font-medium tabular-nums">
            {draft.sourceScope.kind === "all" ? "전체 응답" : "선택한 기간"} · {sourceCount}명
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">최종 응답</span>
          <Input
            inputMode="numeric"
            value={finalCount ?? ""}
            onChange={(event) => {
              const next = Number(event.target.value);
              setDraft((current) => ({
                ...current,
                finalCount:
                  event.target.value === "" || !Number.isFinite(next) ? null : Math.trunc(next),
              }));
            }}
            className="h-8 w-24 tabular-nums"
            aria-invalid={finalCountInvalid}
          />
          <span>명</span>
          {additions !== null ? (
            <span className="text-muted-foreground tabular-nums">+{additions}명</span>
          ) : null}
        </div>
        {finalCountInvalid ? (
          <span className="text-xs text-destructive">
            최종 응답 수는 원본 응답 수보다 작을 수 없습니다.
          </span>
        ) : null}
      </div>

      <div className="grid min-h-[560px] grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 border-r">
          <div className="space-y-3 border-b p-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="문항 검색..."
              aria-label="문항 검색"
              className="h-8"
            />
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={targetOnly ? "ghost" : "secondary"}
                className="h-7 px-2"
                onClick={() => setTargetOnly(false)}
              >
                모든 문항 {questions.length}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={targetOnly ? "secondary" : "ghost"}
                className="h-7 px-2"
                onClick={() => setTargetOnly(true)}
              >
                목표 {draft.targets.length}
              </Button>
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-2">
            {filteredQuestions.map((question) => {
              const count = targetCountFor(question.id);
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setSelectedQuestionId(question.id)}
                  className={`flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/70 ${question.id === selectedQuestion?.id ? "bg-muted font-medium" : ""}`}
                >
                  <span className="line-clamp-2 min-w-0">{question.title}</span>
                  {count > 0 ? (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      목표 {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 overflow-y-auto px-8 py-7">
          {selectedQuestion ? (
            <div className="max-w-[880px]">
              <header>
                <h2 className="text-xl font-semibold tracking-tight">{selectedQuestion.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedQuestion.kind === "multi_choice"
                    ? `복수 선택 · 응답 대상 ${selectedCheckboxDenominator ?? 0}명`
                    : `${kindLabel(selectedQuestion.kind)} · 응답 ${sourceCount}명`}
                </p>
              </header>

              {selectedQuestion.kind === "single_choice"
                ? renderChoiceRows(selectedQuestion, "option")
                : null}
              {selectedQuestion.kind === "multi_choice"
                ? renderChoiceRows(selectedQuestion, "checkbox_option")
                : null}
              {selectedQuestion.kind === "ordinal" ? (
                <div className="mt-8 max-w-md">
                  <p className="text-xs font-medium text-muted-foreground">평균</p>
                  <div className="mt-2 flex items-end justify-between gap-4">
                    <div className="flex items-baseline gap-3">
                      <span className="text-3xl font-medium tabular-nums">
                        {meanMetric(profile, selectedQuestion.id)?.mean.toFixed(2) ?? "—"}
                      </span>
                      {meanTarget(draft.targets, selectedQuestion.id)?.intent ? (
                        <span className="text-sm font-medium tabular-nums">
                          → {meanTarget(draft.targets, selectedQuestion.id)?.intent?.value.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={selectedQuestion.min === undefined || selectedQuestion.max === undefined}
                      onClick={() => openMeanTarget(selectedQuestion)}
                    >
                      목표 설정
                    </Button>
                  </div>
                  {selectedQuestion.min !== undefined && selectedQuestion.max !== undefined ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      가능한 범위 {selectedQuestion.min}–{selectedQuestion.max}
                    </p>
                  ) : null}
                  <p className="mt-8 text-sm text-muted-foreground">
                    점수별 분포는 현재 목표 프로필 계약에서 제공하지 않아 평균만 표시합니다.
                  </p>
                </div>
              ) : null}
              {selectedQuestion.kind === "text" ? (
                <p className="mt-10 text-sm text-muted-foreground">
                  단답형 응답은 다음 단계에서 사용자 정의 그룹으로 묶어 목표에 사용할 수 있습니다.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex min-h-14 items-center justify-between gap-4 border-t px-4 py-2">
        <p className="text-sm text-muted-foreground">
          원본 <span className="tabular-nums">{sourceCount}명</span>
          {additions !== null ? ` · +${additions}명 · 최종 ${finalCount}명` : ""}
          {` · ${draft.targets.length > 0 ? `목표 ${draft.targets.length}개` : "목표 없음"}`}
        </p>
        <Button type="button" disabled={busy || finalCountInvalid} onClick={() => void generate()}>
          {busy ? "설정 확인 중…" : "생성"}
        </Button>
      </footer>

      {message ? (
        <p className="border-t px-4 py-2 text-sm text-muted-foreground">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{editing?.optionLabel ?? "목표"}</SheetTitle>
            <SheetDescription>
              {editing?.questionTitle ?? "문항"} · 현재{" "}
              {currentMetric
                ? editing?.subjectKind === "checkbox_option"
                  ? `${currentMetric.count}/${currentMetric.denominatorCount}명 · ${formatShare(currentMetric.share)}`
                  : `${currentMetric.count}명 · ${formatShare(currentMetric.share)}`
                : "0명 · 0.0%"}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">목표</label>
              <Select
                value={mode}
                onValueChange={(nextMode) => {
                  setMode(nextMode as TargetMode);
                  setValue("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="absolute_share">최종 비율</SelectItem>
                  <SelectItem value="percentage_point_delta">현재보다 %p 변경</SelectItem>
                  <SelectItem value="relative_percent_delta">현재 비율에서 % 변경</SelectItem>
                  <SelectItem value="absolute_count">최종 인원수</SelectItem>
                  <SelectItem value="count_delta">현재보다 인원수 변경</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  inputMode={isShareMode ? "decimal" : "numeric"}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-invalid={value !== "" && valueInvalid}
                  className="tabular-nums"
                  placeholder={isShareMode ? "예: 50" : "예: 125"}
                />
                <span className="w-8 text-sm">
                  {isShareMode ? (mode === "percentage_point_delta" ? "%p" : "%") : "명"}
                </span>
              </div>
              {value !== "" && valueInvalid ? (
                <p className="text-xs text-destructive">유효한 목표 값을 입력해주세요.</p>
              ) : null}
            </div>
            {currentMetric && value !== "" && !valueInvalid ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium tabular-nums">현재 {formatShare(currentMetric.share)}</p>
                {resolvedShare !== null ? (
                  <p className="text-muted-foreground tabular-nums">
                    → 목표 {formatShare(resolvedShare)}
                    {finalCount !== null
                      ? ` · 최종 ${finalCount}명 기준 약 ${Math.round(resolvedShare * finalCount)}명`
                      : ""}
                  </p>
                ) : (
                  <p className="text-muted-foreground tabular-nums">
                    →{" "}
                    {mode === "absolute_count"
                      ? `최종 ${parsed}명`
                      : `${parsed >= 0 ? "+" : ""}${parsed}명`}
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <SheetFooter className="flex-row items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={!existingEditingTarget}
              onClick={removeTarget}
            >
              목표 삭제
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                취소
              </Button>
              <Button type="button" disabled={valueInvalid} onClick={commitTarget}>
                목표 설정
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={editingMean !== null} onOpenChange={(open) => !open && setEditingMean(null)}>
        <SheetContent className="sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle>{editingMean?.questionTitle ?? "평균 목표"}</SheetTitle>
            <SheetDescription>
              현재 평균 {currentMeanMetric?.mean.toFixed(2) ?? "—"}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">목표 평균</label>
              <Input
                autoFocus
                inputMode="decimal"
                value={meanValue}
                onChange={(event) => setMeanValue(event.target.value)}
                aria-invalid={meanValue !== "" && meanValueInvalid}
                className="tabular-nums"
                placeholder={editingMean ? `${editingMean.min}–${editingMean.max}` : ""}
              />
              {editingMean ? (
                <p className="text-xs text-muted-foreground">
                  가능한 범위 {editingMean.min}–{editingMean.max}
                </p>
              ) : null}
              {meanValue !== "" && meanValueInvalid ? (
                <p className="text-xs text-destructive">가능한 범위 안에서 평균을 입력해주세요.</p>
              ) : null}
            </div>
            {currentMeanMetric && meanValue !== "" && !meanValueInvalid ? (
              <p className="text-sm font-medium tabular-nums">
                {currentMeanMetric.mean.toFixed(2)} → {parsedMean.toFixed(2)}
              </p>
            ) : null}
          </div>
          <SheetFooter className="flex-row items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={!existingMeanTarget}
              onClick={removeMeanTarget}
            >
              목표 삭제
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingMean(null)}>
                취소
              </Button>
              <Button type="button" disabled={meanValueInvalid} onClick={commitMeanTarget}>
                목표 설정
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
