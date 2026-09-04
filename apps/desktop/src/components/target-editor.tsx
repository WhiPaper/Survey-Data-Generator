import { useState } from "react";

import type {
  ConditionalGoal,
  FormSnapshot,
  ProjectTargets,
  QuestionTarget,
  TextClusterGroup,
} from "@survey-synth/domain";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConditionalGoalDialog } from "./conditional-goal-dialog";

export type TargetEditorProps = {
  readonly form: FormSnapshot;
  readonly sourceCount: number;
  readonly targets: ProjectTargets;
  readonly onChange: (targets: ProjectTargets) => void;
  readonly onGenerate: () => void;
  readonly disabled: boolean;
  readonly error?: string;
  readonly profiles?: readonly Record<string, unknown>[];
};

const profileFor = (profiles: readonly Record<string, unknown>[], questionId: string) =>
  profiles.find((profile) => profile.questionId === questionId);

const isNumericText = (profiles: readonly Record<string, unknown>[], questionId: string): boolean =>
  (profileFor(profiles, questionId)?.semanticInference as { inferred?: string } | undefined)
    ?.inferred === "numeric";

export const questionLabel = (
  form: FormSnapshot,
  questionId: string,
  optionKey?: string,
): string => {
  const question = form.questions.find((item) => item.id === questionId);
  if (question === undefined) return "삭제된 문항";
  if (
    optionKey !== undefined &&
    (question.kind === "single_choice" || question.kind === "multi_choice")
  ) {
    const option = question.options.find((item) => item.key === optionKey);
    return option === undefined ? question.title : `${question.title}: ${option.label}`;
  }
  return question.title;
};

export const conditionLabel = (
  form: FormSnapshot,
  condition: ConditionalGoal["condition"],
): string => {
  switch (condition.kind) {
    case "option_selected":
      return questionLabel(form, condition.questionId, condition.optionKey);
    case "answered":
      return `${questionLabel(form, condition.questionId)} 응답`;
    case "and":
      return condition.conditions.map((item) => conditionLabel(form, item)).join(" · ");
    case "or":
      return condition.conditions.map((item) => conditionLabel(form, item)).join(" 또는 ");
  }
};

export function TargetEditor({
  form,
  sourceCount,
  targets,
  onChange,
  onGenerate,
  disabled,
  error,
  profiles = [],
}: TargetEditorProps) {
  const [activeQuestionIds, setActiveQuestionIds] = useState<readonly string[]>([]);
  const [unit, setUnit] = useState<"ratio" | "count">("ratio");
  const [conditionalGoalDialogOpen, setConditionalGoalDialogOpen] = useState(false);

  const adjustableQuestions = form.questions.filter(
    (question) =>
      question.kind === "single_choice" ||
      question.kind === "multi_choice" ||
      question.kind === "ordinal" ||
      question.kind === "text",
  );

  const conditionQuestions = form.questions.filter(
    (question) => question.kind === "single_choice" || question.kind === "multi_choice",
  );

  const addQuestion = (questionId: string) => {
    if (questionId === "") return;
    setActiveQuestionIds((current) =>
      current.includes(questionId) ? current : [...current, questionId],
    );
  };

  const removeQuestion = (questionId: string) => {
    setActiveQuestionIds((current) => current.filter((id) => id !== questionId));
    onChange({
      ...targets,
      questionTargets: targets.questionTargets.filter((target) => target.questionId !== questionId),
    });
  };

  const optionTargetFor = (
    questionId: string,
    optionKey: string,
  ): Extract<QuestionTarget, { kind: "option" }> | undefined =>
    targets.questionTargets.find(
      (target) =>
        target.kind === "option" &&
        target.questionId === questionId &&
        target.optionKey === optionKey,
    ) as Extract<QuestionTarget, { kind: "option" }> | undefined;

  const updateOptionTarget = (
    questionId: string,
    optionKey: string,
    value: string,
    semantic: "ratio" | "count",
  ) => {
    const question = form.questions.find((item) => item.id === questionId);
    if (
      question === undefined ||
      (question.kind !== "single_choice" && question.kind !== "multi_choice")
    )
      return;
    const option = question.options.find((item) => item.key === optionKey);
    if (option === undefined) return;
    if (value.trim() === "") {
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.filter(
          (target) =>
            !(
              target.kind === "option" &&
              target.questionId === questionId &&
              target.optionKey === optionKey
            ),
        ),
      });
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextValue = semantic === "ratio" ? numeric / 100 : numeric;
    const current = optionTargetFor(questionId, optionKey);
    const next = current
      ? targets.questionTargets.map((target) =>
          target === current ? { ...target, target: { kind: semantic, value: nextValue } } : target,
        )
      : [
          ...targets.questionTargets,
          {
            kind: "option" as const,
            questionId: question.id,
            optionKey: option.key,
            target: { kind: semantic, value: nextValue },
          },
        ];
    onChange({ ...targets, questionTargets: next as QuestionTarget[] });
  };

  const setOptionRange = (questionId: string, optionKey: string, enabled: boolean) => {
    const current = optionTargetFor(questionId, optionKey);
    if (current === undefined) return;
    const target = current.target;
    if (enabled && (target.kind === "ratio" || target.kind === "count")) {
      const kind = target.kind === "ratio" ? "ratio_range" : "count_range";
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.map((item) =>
          item === current
            ? { ...item, target: { kind, min: target.value, max: target.value } }
            : item,
        ) as QuestionTarget[],
      });
    }
    if (!enabled && (target.kind === "ratio_range" || target.kind === "count_range")) {
      const kind = target.kind === "ratio_range" ? "ratio" : "count";
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.map((item) =>
          item === current ? { ...item, target: { kind, value: target.min } } : item,
        ) as QuestionTarget[],
      });
    }
  };

  const updateRangeBound = (
    questionId: string,
    optionKey: string,
    bound: "min" | "max",
    value: string,
  ) => {
    const current = optionTargetFor(questionId, optionKey);
    if (
      current === undefined ||
      (current.target.kind !== "ratio_range" && current.target.kind !== "count_range")
    )
      return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const normalized = current.target.kind === "ratio_range" ? numeric / 100 : numeric;
    onChange({
      ...targets,
      questionTargets: targets.questionTargets.map((item) =>
        item === current ? { ...item, target: { ...item.target, [bound]: normalized } } : item,
      ) as QuestionTarget[],
    });
  };

  const updateMean = (questionId: string, value: string) => {
    const question = form.questions.find((item) => item.id === questionId);
    if (question === undefined || (question.kind !== "ordinal" && question.kind !== "text")) return;
    const current = targets.questionTargets.find(
      (target) => target.kind === "mean" && target.questionId === questionId,
    );
    if (value.trim() === "") {
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.filter((target) => target !== current),
      });
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    if (question?.kind === "ordinal" && (numeric < question.min || numeric > question.max)) return;
    onChange({
      ...targets,
      questionTargets: current
        ? targets.questionTargets.map((target) =>
            target === current ? { ...target, target: { kind: "mean", value: numeric } } : target,
          )
        : [
            ...targets.questionTargets,
            {
              kind: "mean" as const,
              questionId: question.id,
              target: { kind: "mean" as const, value: numeric },
            },
          ],
    });
  };

  const selectionCountTargetFor = (
    questionId: string,
  ): Extract<QuestionTarget, { kind: "selection_count_mean" }> | undefined =>
    targets.questionTargets.find(
      (target) => target.kind === "selection_count_mean" && target.questionId === questionId,
    ) as Extract<QuestionTarget, { kind: "selection_count_mean" }> | undefined;

  const updateSelectionCountMean = (questionId: string, value: string) => {
    const question = form.questions.find((item) => item.id === questionId);
    if (question?.kind !== "multi_choice") return;
    const current = selectionCountTargetFor(questionId);
    if (value.trim() === "") {
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.filter((target) => target !== current),
      });
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    onChange({
      ...targets,
      questionTargets: current
        ? targets.questionTargets.map((target) =>
            target === current ? { ...target, target: { kind: "mean", value: numeric } } : target,
          )
        : [
            ...targets.questionTargets,
            {
              kind: "selection_count_mean" as const,
              questionId: question.id,
              target: { kind: "mean" as const, value: numeric },
            },
          ],
    });
  };

  const removeConditionalGoal = (goalId: string) =>
    onChange({
      ...targets,
      detailedGoals: (targets.detailedGoals ?? []).filter((goal) => goal.id !== goalId),
    });

  const conditionalGoalOutcomeLabel = (goal: ConditionalGoal): string => {
    const target = goal.outcome.target;
    if (target.kind === "ratio") return `${Math.round(target.value * 100)}%`;
    if (target.kind === "count") return `${target.value}명`;
    if (target.kind === "ratio_range")
      return `${Math.round(target.min * 100)}–${Math.round(target.max * 100)}%`;
    if (target.kind === "count_range") return `${target.min}–${target.max}명`;
    return target.value.toFixed(2);
  };

  const activeIds = new Set([
    ...activeQuestionIds,
    ...targets.questionTargets.map((target) => String(target.questionId)),
  ]);

  return (
    <section className="target-editor" aria-labelledby="target-editor-title">
      <Field orientation="responsive" className="count-editor">
        <FieldLabel htmlFor="target-response-count">최종 응답</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="target-response-count"
            type="number"
            min={sourceCount}
            step="1"
            value={Number.isNaN(targets.targetResponseCount) ? "" : targets.targetResponseCount}
            onChange={(event) =>
              onChange({
                ...targets,
                targetResponseCount: event.target.value === "" ? NaN : Number(event.target.value),
              })
            }
            disabled={disabled}
            aria-invalid={
              targets.targetResponseCount < sourceCount ||
              !Number.isInteger(targets.targetResponseCount)
            }
            className="w-24"
          />
          <span className="text-sm">명</span>
          <span className="text-sm text-muted-foreground">원본 {sourceCount}명</span>
        </div>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="target-editor-title" className="text-base font-semibold">
          목표
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConditionalGoalDialogOpen(true)}
            disabled={disabled || conditionQuestions.length === 0}
          >
            조건 추가
          </Button>
          <Select
            value={null}
            onValueChange={(value) => addQuestion(value ?? "")}
            disabled={disabled}
          >
            <SelectTrigger aria-label="조정할 문항 추가">
              <SelectValue placeholder="문항 추가" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {adjustableQuestions
                  .filter((question) => !activeIds.has(String(question.id)))
                  .map((question) => (
                    <SelectItem key={question.id} value={question.id}>
                      {question.title}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="target-list">
        {adjustableQuestions
          .filter((question) => activeIds.has(String(question.id)))
          .map((question) => {
            if (question.kind === "single_choice" || question.kind === "multi_choice") {
              const choices =
                (profileFor(profiles, question.id)?.choices as
                  Record<string, { share: number }> | undefined) ?? {};
              return (
                <div className="target-row" key={question.id}>
                  <div className="target-row-head">
                    <strong className="text-sm font-medium">{question.title}</strong>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuestion(question.id)}
                      disabled={disabled}
                    >
                      제거
                    </Button>
                  </div>
                  <ToggleGroup
                    value={[unit]}
                    onValueChange={(value) => {
                      if (value[0] === "ratio" || value[0] === "count") setUnit(value[0]);
                    }}
                    aria-label="표시 단위"
                    size="sm"
                    variant="outline"
                    spacing={0}
                  >
                    <ToggleGroupItem value="ratio">%</ToggleGroupItem>
                    <ToggleGroupItem value="count">명</ToggleGroupItem>
                  </ToggleGroup>
                  {question.options.map((option) => {
                    const target = optionTargetFor(question.id, option.key);
                    const current = choices[String(option.key)]?.share;
                    const range =
                      target?.target.kind === "ratio_range" ||
                      target?.target.kind === "count_range";
                    const rangeTarget =
                      target?.target.kind === "ratio_range" || target?.target.kind === "count_range"
                        ? target.target
                        : undefined;
                    const exactTarget =
                      target?.target.kind === "ratio" || target?.target.kind === "count"
                        ? target.target
                        : undefined;
                    const targetIsRatio = target?.target.kind.startsWith("ratio") ?? false;
                    const toDisplay = (value: number) =>
                      unit === "ratio"
                        ? targetIsRatio
                          ? value * 100
                          : (value / targets.targetResponseCount) * 100
                        : targetIsRatio
                          ? Math.round(value * targets.targetResponseCount)
                          : value;
                    const exactValue =
                      exactTarget !== undefined ? toDisplay(exactTarget.value) : "";
                    return (
                      <div className="choice-target" key={option.key}>
                        <span className="text-sm">{option.label}</span>
                        <span className="text-sm text-muted-foreground">
                          현재 {current === undefined ? "-" : `${Math.round(current * 100)}%`}
                        </span>
                        {rangeTarget !== undefined ? (
                          <Field orientation="horizontal" className="w-auto items-center gap-1">
                            <FieldLabel className="sr-only">{option.label} 범위 목표</FieldLabel>
                            <Input
                              type="number"
                              min="0"
                              max={unit === "ratio" ? 100 : targets.targetResponseCount}
                              value={toDisplay(rangeTarget.min)}
                              onChange={(event) =>
                                updateRangeBound(
                                  question.id,
                                  String(option.key),
                                  "min",
                                  event.target.value,
                                )
                              }
                              disabled={disabled}
                              className="w-18"
                            />
                            <span className="text-sm text-muted-foreground">–</span>
                            <Input
                              type="number"
                              min="0"
                              max={unit === "ratio" ? 100 : targets.targetResponseCount}
                              value={toDisplay(rangeTarget.max)}
                              onChange={(event) =>
                                updateRangeBound(
                                  question.id,
                                  String(option.key),
                                  "max",
                                  event.target.value,
                                )
                              }
                              disabled={disabled}
                              className="w-18"
                            />
                            <span className="text-sm">{unit === "ratio" ? "%" : "명"}</span>
                          </Field>
                        ) : (
                          <Field orientation="horizontal" className="w-auto items-center gap-1">
                            <FieldLabel className="sr-only">{option.label} 목표</FieldLabel>
                            <Input
                              type="number"
                              min="0"
                              max={unit === "ratio" ? 100 : targets.targetResponseCount}
                              step="1"
                              value={exactValue}
                              onChange={(event) =>
                                updateOptionTarget(
                                  question.id,
                                  String(option.key),
                                  event.target.value,
                                  unit,
                                )
                              }
                              disabled={disabled}
                              className="w-20"
                            />
                            <span className="text-sm">{unit === "ratio" ? "%" : "명"}</span>
                          </Field>
                        )}
                        {target !== undefined && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setOptionRange(question.id, String(option.key), !range)}
                            disabled={disabled}
                          >
                            {range ? "정확값" : "범위"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {question.kind === "multi_choice" && (
                    <Field orientation="horizontal" className="w-auto items-center">
                      <FieldLabel>선택 수 평균</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        max={question.options.length}
                        step="0.1"
                        value={selectionCountTargetFor(question.id)?.target.value ?? ""}
                        onChange={(event) =>
                          updateSelectionCountMean(question.id, event.target.value)
                        }
                        disabled={disabled}
                        className="w-24"
                      />
                    </Field>
                  )}
                </div>
              );
            }
            if (question.kind === "ordinal") {
              const target = targets.questionTargets.find(
                (item) => item.kind === "mean" && item.questionId === question.id,
              );
              return (
                <div className="target-row" key={question.id}>
                  <div className="target-row-head">
                    <strong className="text-sm font-medium">{question.title}</strong>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuestion(question.id)}
                      disabled={disabled}
                    >
                      제거
                    </Button>
                  </div>
                  <Field orientation="horizontal" className="w-auto items-center">
                    <FieldLabel>목표 평균</FieldLabel>
                    <Input
                      type="number"
                      min={question.min}
                      max={question.max}
                      step="0.01"
                      value={target?.target.kind === "mean" ? target.target.value.toFixed(2) : ""}
                      onChange={(event) => updateMean(question.id, event.target.value)}
                      disabled={disabled}
                      className="w-24"
                    />
                  </Field>
                </div>
              );
            }
            if (question.kind === "text") {
              if (isNumericText(profiles, question.id)) {
                const target = targets.questionTargets.find(
                  (item) => item.kind === "mean" && item.questionId === question.id,
                );
                const current = (
                  profileFor(profiles, question.id)?.numeric as { mean?: number } | undefined
                )?.mean;
                return (
                  <div className="target-row" key={question.id}>
                    <div className="target-row-head">
                      <strong className="text-sm font-medium">{question.title}</strong>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(question.id)}
                        disabled={disabled}
                      >
                        제거
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      현재 평균 {current === undefined ? "-" : current.toFixed(2)}
                    </p>
                    <Field orientation="horizontal" className="w-auto items-center">
                      <FieldLabel>목표 평균</FieldLabel>
                      <Input
                        type="number"
                        step="0.01"
                        value={target?.target.kind === "mean" ? target.target.value.toFixed(2) : ""}
                        onChange={(event) => updateMean(question.id, event.target.value)}
                        disabled={disabled}
                        className="w-24"
                      />
                    </Field>
                  </div>
                );
              }

              const clusters = (
                profileFor(profiles, question.id) as
                  | { textClusters?: readonly TextClusterGroup[] }
                  | undefined
              )?.textClusters ?? [];

              if (clusters.length > 0) {
                return (
                  <div className="target-row" key={question.id}>
                    <div className="target-row-head">
                      <div>
                        <strong className="text-sm font-medium">{question.title}</strong>
                        <p className="text-xs text-muted-foreground">유사 응답 자동 그룹화</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(question.id)}
                        disabled={disabled}
                      >
                        제거
                      </Button>
                    </div>
                    <div className="flex flex-col divide-y border rounded-md mt-2">
                      {clusters.map((cluster) => {
                        const target = targets.questionTargets.find(
                          (t) =>
                            t.kind === "text_cluster" &&
                            t.questionId === question.id &&
                            t.clusterId === cluster.id,
                        ) as Extract<QuestionTarget, { kind: "text_cluster" }> | undefined;
                        const value =
                          target?.target.kind === "ratio"
                            ? Math.round(target.target.value * 100)
                            : target?.target.kind === "count"
                              ? target.target.value
                              : "";
                        return (
                          <div
                            key={cluster.id}
                            className="flex items-center justify-between p-2 text-xs"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">{cluster.label}</span>
                              <span className="text-muted-foreground">
                                현재 {Math.round(cluster.share * 100)}% ({cluster.count}명)
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Input
                                type="number"
                                placeholder="%"
                                className="w-16 h-7 text-right text-xs"
                                value={value}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (val === "") {
                                    onChange({
                                      ...targets,
                                      questionTargets: targets.questionTargets.filter(
                                        (t) =>
                                          !(
                                            t.kind === "text_cluster" &&
                                            t.questionId === question.id &&
                                            t.clusterId === cluster.id
                                          ),
                                      ),
                                    });
                                    return;
                                  }
                                  const num = Number(val);
                                  if (!Number.isFinite(num)) return;
                                  const nextTarget = { kind: "ratio" as const, value: num / 100 };
                                  onChange({
                                    ...targets,
                                    questionTargets:
                                      target === undefined
                                        ? [
                                            ...targets.questionTargets,
                                            {
                                              kind: "text_cluster",
                                              questionId: question.id,
                                              clusterId: cluster.id,
                                              label: cluster.label,
                                              memberTexts: cluster.memberTexts,
                                              target: nextTarget,
                                            },
                                          ]
                                        : targets.questionTargets.map((item) =>
                                            item === target ? { ...item, target: nextTarget } : item,
                                          ),
                                  });
                                }}
                                disabled={disabled}
                              />
                              <span>%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
            }
            return null;
          })}
      </div>
      {(targets.detailedGoals ?? []).length > 0 && (
        <div className="target-list">
          {(targets.detailedGoals ?? []).map((goal) => (
            <div className="target-row" key={goal.id}>
              <div className="target-row-head">
                <span className="text-sm">
                  {conditionLabel(form, goal.condition)} →{" "}
                  {questionLabel(
                    form,
                    goal.outcome.questionId,
                    goal.outcome.kind === "option" ? goal.outcome.optionKey : undefined,
                  )}{" "}
                  {conditionalGoalOutcomeLabel(goal)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeConditionalGoal(goal.id)}
                  disabled={disabled}
                >
                  제거
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConditionalGoalDialog
        open={conditionalGoalDialogOpen}
        onOpenChange={setConditionalGoalDialogOpen}
        form={form}
        onAddGoal={(goal) =>
          onChange({
            ...targets,
            detailedGoals: [...(targets.detailedGoals ?? []), goal],
          })
        }
      />
      {error !== undefined && <FieldError>{error}</FieldError>}
      <Button
        onClick={onGenerate}
        disabled={
          disabled ||
          !Number.isInteger(targets.targetResponseCount) ||
          targets.targetResponseCount < sourceCount
        }
      >
        데이터 생성
      </Button>
    </section>
  );
}
