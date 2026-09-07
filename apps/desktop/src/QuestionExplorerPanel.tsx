import { useEffect, useMemo, useState } from "react";

import type {
  ProjectDetailView,
  SourceScope,
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

type QuestionView = {
  id: string;
  title: string;
  kind: string;
  options: Array<{ key: string; label: string }>;
};

type TargetMode =
  | "absolute_share"
  | "percentage_point_delta"
  | "relative_percent_delta"
  | "absolute_count"
  | "count_delta";

type EditingTarget = {
  questionId: string;
  optionKey: string;
  optionLabel: string;
};

const questionsFromProject = (project: ProjectDetailView): QuestionView[] => {
  const raw = Array.isArray(project.form.questions) ? project.form.questions : [];
  return raw.flatMap((value) => {
    const question = asRecord(value);
    if (!question || typeof question.id !== "string") return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((item) => {
          const option = asRecord(item);
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
      },
    ];
  });
};

const questionKindLabel = (kind: string): string => {
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

const targetForOption = (
  targets: readonly TargetDraftTarget[],
  questionId: string,
  optionKey: string,
): TargetDraftTarget | undefined =>
  targets.find(
    (target) =>
      (target.kind === "share" || target.kind === "count") &&
      target.subject.kind === "option" &&
      target.subject.questionId === questionId &&
      target.subject.optionKey === optionKey,
  );

const metricForOption = (
  profile: TargetProfileResult | null,
  questionId: string,
  optionKey: string,
): Extract<TargetProfileMetric, { kind: "subject" }> | undefined =>
  profile?.metrics.find(
    (metric): metric is Extract<TargetProfileMetric, { kind: "subject" }> =>
      metric.kind === "subject" &&
      metric.subject.kind === "option" &&
      metric.subject.questionId === questionId &&
      metric.subject.optionKey === optionKey,
  );

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const modeForTarget = (target: TargetDraftTarget | undefined): TargetMode => {
  if (!target || (target.kind !== "share" && target.kind !== "count")) return "absolute_share";
  if (target.kind === "count") return target.intent?.kind === "count_delta" ? "count_delta" : "absolute_count";
  if (target.intent?.kind === "percentage_point_delta") return "percentage_point_delta";
  if (target.intent?.kind === "relative_percent_delta") return "relative_percent_delta";
  return "absolute_share";
};

const displayValueForTarget = (target: TargetDraftTarget | undefined): string => {
  if (!target || (target.kind !== "share" && target.kind !== "count") || !target.intent) return "";
  if (target.kind === "count") return String(target.intent.value);
  return String(target.intent.value * 100);
};

const targetSummary = (target: TargetDraftTarget | undefined, currentShare: number): string | null => {
  if (!target || (target.kind !== "share" && target.kind !== "count") || !target.intent) return null;
  if (target.kind === "count") {
    const prefix = target.intent.kind === "count_delta" && target.intent.value > 0 ? "+" : "";
    return target.intent.kind === "count_delta"
      ? `${prefix}${target.intent.value}명`
      : `최종 ${target.intent.value}명`;
  }
  if (target.intent.kind === "percentage_point_delta") {
    const delta = target.intent.value * 100;
    const resolved = currentShare + target.intent.value;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%p → ${percent(resolved)}`;
  }
  if (target.intent.kind === "relative_percent_delta") {
    const delta = target.intent.value * 100;
    const resolved = currentShare * (1 + target.intent.value);
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% → ${percent(resolved)}`;
  }
  return `→ ${percent(target.intent.value)}`;
};

const targetId = (kind: "share" | "count", questionId: string, optionKey: string): TargetId =>
  `${kind}:option:${questionId}:${optionKey}` as TargetId;

export function QuestionExplorerPanel({ project }: { project: ProjectDetailView }) {
  const questions = useMemo(() => questionsFromProject(project), [project]);
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
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>("absolute_share");
  const [targetValue, setTargetValue] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedQuestionId(questions[0]?.id ?? "");
  }, [project.id]);

  useEffect(() => {
    let active = true;
    setBusy(true);
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
        const nextProfile = await getTargetProfile(project.id, nextDraft.sourceScope);
        if (active) setProfile(nextProfile);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, project.currentSourceRevisionId, project.responseCount]);

  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId) ?? questions[0];
  const targetCountForQuestion = (questionId: string): number =>
    draft.targets.filter((target) => questionIdForTarget(target) === questionId).length;
  const totalTargetCount = draft.targets.length;
  const filteredQuestions = questions.filter((question) => {
    const matchesQuery = question.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const matchesTarget = !targetOnly || targetCountForQuestion(question.id) > 0;
    return matchesQuery && matchesTarget;
  });

  const openTarget = (questionId: string, optionKey: string, optionLabel: string) => {
    const existing = targetForOption(draft.targets, questionId, optionKey);
    setEditingTarget({ questionId, optionKey, optionLabel });
    setTargetMode(modeForTarget(existing));
    setTargetValue(displayValueForTarget(existing));
  };

  const commitTarget = async (): Promise<void> => {
    if (!editingTarget) return;
    const numeric = Number(targetValue);
    if (!Number.isFinite(numeric)) return;
    const nextKind: "share" | "count" =
      targetMode === "absolute_count" || targetMode === "count_delta" ? "count" : "share";
    const normalized = nextKind === "share" ? numeric / 100 : numeric;
    const intent =
      targetMode === "percentage_point_delta"
        ? ({ kind: "percentage_point_delta", value: normalized } as const)
        : targetMode === "relative_percent_delta"
          ? ({ kind: "relative_percent_delta", value: normalized } as const)
          : targetMode === "count_delta"
            ? ({ kind: "count_delta", value: Math.trunc(normalized) } as const)
            : ({ kind: "absolute", value: nextKind === "count" ? Math.trunc(normalized) : normalized } as const);
    const nextTarget: TargetDraftTarget = {
      id: targetId(nextKind, editingTarget.questionId, editingTarget.optionKey),
      kind: nextKind,
      subject: {
        kind: "option",
        questionId: editingTarget.questionId,
        optionKey: editingTarget.optionKey,
      },
      intent,
    };
    const nextDraft: TargetDraft = {
      ...draft,
      targets: [
        ...draft.targets.filter(
          (target) =>
            !(
              (target.kind === "share" || target.kind === "count") &&
              target.subject.kind === "option" &&
              target.subject.questionId === editingTarget.questionId &&
              target.subject.optionKey === editingTarget.optionKey
            ),
        ),
        nextTarget,
      ],
    };
    setBusy(true);
    setError(null);
    try {
      await saveTargetDraft(nextDraft);
      setDraft(nextDraft);
      setEditingTarget(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "목표를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeEditingTarget = async (): Promise<void> => {
    if (!editingTarget) return;
    const nextDraft: TargetDraft = {
      ...draft,
      targets: draft.targets.filter(
        (target) =>
          !(
            (target.kind === "share" || target.kind === "count") &&
            target.subject.kind === "option" &&
            target.subject.questionId === editingTarget.questionId &&
            target.subject.optionKey === editingTarget.optionKey
          ),
      ),
    };
    setBusy(true);
    try {
      await saveTargetDraft(nextDraft);
      setDraft(nextDraft);
      setEditingTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const updateFinalCount = (value: string) => {
    const numeric = Number(value);
    setDraft((current) => ({
      ...current,
      finalCount: value === "" || !Number.isFinite(numeric) ? null : Math.trunc(numeric),
    }));
  };

  const saveAndGenerate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
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

  const sourceCount = profile?.responseCount ?? project.responseCount;
  const finalCount = draft.finalCount;
  const additions = finalCount === null ? null : Math.max(0, finalCount - sourceCount);
  const finalCountInvalid = finalCount === null || finalCount < sourceCount;
  const selectedMetric =
    editingTarget === null
      ? undefined
      : metricForOption(profile, editingTarget.questionId, editingTarget.optionKey);
  const parsedTargetValue = Number(targetValue);
  const shareMode =
    targetMode === "absolute_share" ||
    targetMode === "percentage_point_delta" ||
    targetMode === "relative_percent_delta";
  const targetValueInvalid =
    !Number.isFinite(parsedTargetValue) ||
    (targetMode === "absolute_share" && (parsedTargetValue < 0 || parsedTargetValue > 100)) ||
    ((targetMode === "absolute_count" || targetMode === "count_delta") && !Number.isInteger(parsedTargetValue));

  return (
    <section className="mt-4 overflow-hidden rounded-lg border bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">원본</span>
          <span className="font-medium tabular-nums">전체 응답 · {sourceCount}명</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">최종 응답</span>
          <Input
            inputMode="numeric"
            value={finalCount ?? ""}
            onChange={(event) => updateFinalCount(event.target.value)}
            className="h-8 w-24 tabular-nums"
            aria-invalid={finalCountInvalid}
          />
          <span>명</span>
          {additions !== null && !finalCountInvalid ? (
            <span className="text-muted-foreground tabular-nums">+{additions}명</span>
          ) : null}
        </div>
        {finalCountInvalid ? (
          <span className="text-xs text-destructive">최종 응답 수는 원본 응답 수보다 작을 수 없습니다.</span>
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
            <div className="flex items-center gap-1 text-xs">
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
                목표 {totalTargetCount}
              </Button>
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-2">
            {filteredQuestions.map((question) => {
              const count = targetCountForQuestion(question.id);
              const selected = question.id === selectedQuestion?.id;
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setSelectedQuestionId(question.id)}
                  className={`flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/70 ${selected ? "bg-muted font-medium" : ""}`}
                >
                  <span className="line-clamp-2 min-w-0">{question.title}</span>
                  {count > 0 ? (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">목표 {count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 overflow-y-auto px-8 py-7">
          {busy && !profile ? <p className="text-sm text-muted-foreground">분포를 불러오는 중…</p> : null}
          {selectedQuestion ? (
            <div className="max-w-[880px]">
              <header>
                <h2 className="text-xl font-semibold tracking-tight">{selectedQuestion.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {questionKindLabel(selectedQuestion.kind)} · 응답 {sourceCount}명
                </p>
              </header>

              {selectedQuestion.kind === "single_choice" ? (
                <div className="mt-7 space-y-1">
                  {selectedQuestion.options.map((option) => {
                    const metric = metricForOption(profile, selectedQuestion.id, option.key);
                    const currentShare = metric?.share ?? 0;
                    const existing = targetForOption(draft.targets, selectedQuestion.id, option.key);
                    const summary = targetSummary(existing, currentShare);
                    return (
                      <button
                        type="button"
                        key={option.key}
                        onClick={() => openTarget(selectedQuestion.id, option.key, option.label)}
                        className="group grid w-full grid-cols-[minmax(140px,1fr)_72px_72px_minmax(120px,1.2fr)_120px] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted/60"
                      >
                        <span className="truncate font-medium">{option.label}</span>
                        <span className="text-right tabular-nums text-muted-foreground">{metric?.count ?? 0}명</span>
                        <span className="text-right tabular-nums">{percent(currentShare)}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-foreground/45"
                            style={{ width: `${Math.max(0, Math.min(100, currentShare * 100))}%` }}
                          />
                        </span>
                        <span className={`text-right tabular-nums ${summary ? "font-medium" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}>
                          {summary ?? "+ 목표"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-10 max-w-lg">
                  <p className="text-sm text-muted-foreground">
                    이 문항의 분포 편집기는 다음 구현 단계에서 같은 Question Explorer 안에 연결됩니다.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex min-h-14 items-center justify-between gap-4 border-t px-4 py-2">
        <p className="text-sm text-muted-foreground">
          원본 <span className="tabular-nums">{sourceCount}명</span>
          {additions !== null && !finalCountInvalid ? ` · +${additions}명 · 최종 ${finalCount}명` : ""}
          {` · ${totalTargetCount > 0 ? `목표 ${totalTargetCount}개` : "목표 없음"}`}
        </p>
        <Button type="button" disabled={busy || finalCountInvalid} onClick={() => void saveAndGenerate()}>
          {busy ? "설정 확인 중…" : "생성"}
        </Button>
      </footer>

      {message ? <p className="border-t px-4 py-2 text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">{error}</p> : null}

      <Sheet open={editingTarget !== null} onOpenChange={(open) => !open && setEditingTarget(null)}>
        <SheetContent className="sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{editingTarget?.optionLabel ?? "목표"}</SheetTitle>
            <SheetDescription>
              {selectedQuestion?.title ?? "문항"} · 현재 {selectedMetric ? `${selectedMetric.count}명 · ${percent(selectedMetric.share)}` : "0명 · 0.0%"}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-4 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">목표</label>
              <Select value={targetMode} onValueChange={(value) => { setTargetMode(value as TargetMode); setTargetValue(""); }}>
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
                  inputMode={shareMode ? "decimal" : "numeric"}
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  aria-invalid={targetValue !== "" && targetValueInvalid}
                  className="tabular-nums"
                  placeholder={shareMode ? "예: 50" : "예: 125"}
                />
                <span className="w-8 text-sm">{shareMode ? (targetMode === "percentage_point_delta" ? "%p" : "%") : "명"}</span>
              </div>
              {targetValue !== "" && targetValueInvalid ? (
                <p className="text-xs text-destructive">유효한 목표 값을 입력해주세요.</p>
              ) : null}
            </div>

            {selectedMetric && targetValue !== "" && !targetValueInvalid ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium tabular-nums">
                  현재 {percent(selectedMetric.share)}
                </p>
                <p className="text-muted-foreground">
                  {targetMode === "absolute_share" && `→ 목표 ${parsedTargetValue.toFixed(1)}%`}
                  {targetMode === "percentage_point_delta" && `→ ${parsedTargetValue >= 0 ? "+" : ""}${parsedTargetValue}%p`}
                  {targetMode === "relative_percent_delta" && `→ ${parsedTargetValue >= 0 ? "+" : ""}${parsedTargetValue}%`}
                  {targetMode === "absolute_count" && `→ 최종 ${parsedTargetValue}명`}
                  {targetMode === "count_delta" && `→ ${parsedTargetValue >= 0 ? "+" : ""}${parsedTargetValue}명`}
                </p>
                {finalCount !== null && targetMode === "absolute_share" ? (
                  <p className="text-muted-foreground">최종 {finalCount}명 기준 약 {Math.round((parsedTargetValue / 100) * finalCount)}명</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <SheetFooter className="flex-row items-center justify-between sm:justify-between">
            <Button type="button" variant="ghost" className="text-destructive" disabled={!editingTarget || busy} onClick={() => void removeEditingTarget()}>
              목표 삭제
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingTarget(null)}>취소</Button>
              <Button type="button" disabled={busy || targetValue === "" || targetValueInvalid} onClick={() => void commitTarget()}>
                목표 설정
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
