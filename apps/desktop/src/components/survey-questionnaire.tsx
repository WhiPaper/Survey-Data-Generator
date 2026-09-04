import { useState } from "react";

import type {
  FormSnapshot,
  ProjectTargets,
  Question,
  QuestionTarget,
  TextClusterGroup,
} from "@survey-synth/domain";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deriveSingleChoiceRatios, splitDistributionAdjustment } from "@/lib/survey-targets";
import { ratiosForScoreMean, recognizeScoreMapping } from "@/lib/score-labels";
import {
  QuestionDistributionChart,
  type DistributionAdjustmentDatum,
} from "./question-distribution-chart";

type QuestionProfile = {
  readonly questionId?: string;
  readonly semanticInference?: { readonly inferred?: string };
  readonly choices?: Readonly<Record<string, { readonly count: number; readonly share: number }>>;
  readonly textClusters?: readonly TextClusterGroup[];
};

type SurveyQuestionEditorProps = {
  readonly form: FormSnapshot;
  readonly questionId: string | null;
  readonly sourceCount: number;
  readonly fullSourceCount: number;
  readonly profiles: readonly Record<string, unknown>[];
  readonly targets: ProjectTargets;
  readonly onChange: (targets: ProjectTargets) => void;
  readonly disabled: boolean;
};

const choiceTargetFor = (
  targets: ProjectTargets,
  questionId: string,
  optionKey: string,
): Extract<QuestionTarget, { kind: "option" }> | undefined =>
  targets.questionTargets.find(
    (target) =>
      target.kind === "option" &&
      target.questionId === questionId &&
      target.optionKey === optionKey,
  ) as Extract<QuestionTarget, { kind: "option" }> | undefined;

const textClusterTargetFor = (
  targets: ProjectTargets,
  questionId: string,
  clusterId: string,
): Extract<QuestionTarget, { kind: "text_cluster" }> | undefined =>
  targets.questionTargets.find(
    (target) =>
      target.kind === "text_cluster" &&
      target.questionId === questionId &&
      target.clusterId === clusterId,
  ) as Extract<QuestionTarget, { kind: "text_cluster" }> | undefined;

const formatTarget = (ratio: number, unit: "ratio" | "count", total: number): string =>
  unit === "ratio" ? `${Math.round(ratio * 100)}%` : `≈${Math.round(ratio * total)}명`;


const choiceRatios = (
  question: Extract<Question, { kind: "single_choice" | "multi_choice" }>,
  choices: QuestionProfile["choices"],
  targets: ProjectTargets,
): ReadonlyMap<string, number> => {
  const current = new Map(
    question.options.map((option) => [option.key, choices?.[option.key]?.share ?? 0]),
  );
  return question.kind === "multi_choice"
    ? current
    : deriveSingleChoiceRatios(
        question.options,
        Object.fromEntries(current),
        targets,
        String(question.id),
      );
};

export function SurveyQuestionEditor({
  form,
  questionId,
  sourceCount,
  fullSourceCount,
  profiles,
  targets,
  onChange,
  disabled,
}: SurveyQuestionEditorProps) {
  const sourceCountScale = fullSourceCount > 0 ? sourceCount / fullSourceCount : 0;
  const question = form.questions.find((item) => item.id === questionId);
  const [unit, setUnit] = useState<"ratio" | "count">("ratio");
  const [editingOptionKey, setEditingOptionKey] = useState<string | null>(null);
  const [scoreMode, setScoreMode] = useState(false);

  if (question === undefined) return null;

  const profile = profiles.find((item) => item.questionId === question.id) as
    QuestionProfile | undefined;
  const isChoiceQuestion = question.kind === "single_choice" || question.kind === "multi_choice";
  const ratios = isChoiceQuestion ? choiceRatios(question, profile?.choices, targets) : new Map();
  const scoreMapping =
    question.kind === "single_choice"
      ? recognizeScoreMapping(question.options.map((option) => option.label))
      : null;
  const currentScoreMean =
    scoreMapping === null || question.kind !== "single_choice"
      ? null
      : question.options.reduce(
          (sum, option) =>
            sum +
            (scoreMapping.get(option.label) ?? 3) *
              (profile?.choices?.[option.key]?.share ?? 0),
          0,
        );

  const updateScoreMean = (value: string) => {
    if (scoreMapping === null || question.kind !== "single_choice") return;
    const mean = Number(value);
    if (!Number.isFinite(mean) || mean < 1 || mean > 5) return;
    const optionLabels = question.options.map((option) => option.label);
    const currentRatios = question.options.map((option) => profile?.choices?.[option.key]?.share ?? 0);
    const nextRatios = ratiosForScoreMean(optionLabels, currentRatios, scoreMapping, mean);
    onChange({
      ...targets,
      questionTargets: [
        ...targets.questionTargets.filter(
          (target) => !(target.kind === "option" && target.questionId === question.id),
        ),
        ...question.options.map((option, index) => ({
          kind: "option" as const,
          questionId: question.id,
          optionKey: option.key,
          target: { kind: "ratio" as const, value: nextRatios[index] ?? 0 },
        })),
      ],
    });
  };
  const chartData: readonly DistributionAdjustmentDatum[] = isChoiceQuestion
    ? question.options.map((option) => {
        const source =
          unit === "ratio"
            ? (profile?.choices?.[option.key]?.share ?? 0) * 100
            : (profile?.choices?.[option.key]?.count ?? 0) * sourceCountScale;
        const target =
          unit === "ratio"
            ? (ratios.get(option.key) ?? 0) * 100
            : (ratios.get(option.key) ?? 0) * targets.targetResponseCount;
        return { option: option.label, ...splitDistributionAdjustment(source, target) };
      })
    : [];

  const clusterChartData: readonly DistributionAdjustmentDatum[] =
    question.kind === "text" && (profile?.textClusters?.length ?? 0) > 0
      ? profile!.textClusters!.map((cluster) => {
          const clusterTarget = textClusterTargetFor(targets, question.id, cluster.id);
          const targetRatio =
            clusterTarget?.target.kind === "ratio"
              ? clusterTarget.target.value
              : clusterTarget?.target.kind === "count"
                ? clusterTarget.target.value / targets.targetResponseCount
                : cluster.share;
          const source = unit === "ratio" ? cluster.share * 100 : cluster.count * sourceCountScale;
          const target =
            unit === "ratio"
              ? targetRatio * 100
              : targetRatio * targets.targetResponseCount;
          return { option: cluster.label, ...splitDistributionAdjustment(source, target) };
        })
      : [];

  const setTarget = (optionKey: string, value: string) => {
    if (!isChoiceQuestion) return;
    const option = question.options.find((item) => item.key === optionKey);
    if (option === undefined) return;
    if (value.trim() === "") {
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.filter(
          (target) =>
            !(
              target.kind === "option" &&
              target.questionId === question.id &&
              target.optionKey === optionKey
            ),
        ),
      });
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const target = choiceTargetFor(targets, question.id, optionKey);
    const nextTarget = { kind: unit, value: unit === "ratio" ? numeric / 100 : numeric } as const;
    onChange({
      ...targets,
      questionTargets:
        target === undefined
          ? [
              ...targets.questionTargets,
              {
                kind: "option",
                questionId: question.id,
                optionKey: option.key,
                target: nextTarget,
              },
            ]
          : targets.questionTargets.map((item) =>
              item === target ? { ...item, target: nextTarget } : item,
            ),
    });
  };

  const setClusterTarget = (cluster: TextClusterGroup, value: string) => {
    if (value.trim() === "") {
      onChange({
        ...targets,
        questionTargets: targets.questionTargets.filter(
          (target) =>
            !(
              target.kind === "text_cluster" &&
              target.questionId === question.id &&
              target.clusterId === cluster.id
            ),
        ),
      });
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const existing = textClusterTargetFor(targets, question.id, cluster.id);
    const nextTarget = { kind: unit, value: unit === "ratio" ? numeric / 100 : numeric } as const;
    onChange({
      ...targets,
      questionTargets:
        existing === undefined
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
              item === existing ? { ...item, target: nextTarget } : item,
            ),
    });
  };

  return (
    <section className="survey-question-editor" aria-labelledby={`question-${question.id}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`question-${question.id}`} className="text-lg font-semibold tracking-tight">
          {question.title}
        </h2>
        {question.required && <span className="text-xs text-muted-foreground">필수</span>}
        {question.description !== undefined && (
          <p className="basis-full text-sm text-muted-foreground">{question.description}</p>
        )}
      </header>
      {isChoiceQuestion && (
        <div className="mt-6 flex flex-col gap-4">
          {question.kind === "single_choice" && (
            <QuestionDistributionChart data={chartData} unit={unit} />
          )}
          {scoreMapping !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={scoreMode ? "secondary" : "outline"}
                size="sm"
                aria-pressed={scoreMode}
                onClick={() => setScoreMode((current) => !current)}
                disabled={disabled}
              >
                {scoreMode ? "점수형" : "선택형"}
              </Button>
              <Tooltip>
                <TooltipTrigger className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4">
                  점수 기준
                </TooltipTrigger>
                <TooltipContent>
                  선택지 의미를 점수로 해석합니다.
                </TooltipContent>
              </Tooltip>
              {scoreMode && currentScoreMean !== null && (
                <Field orientation="horizontal" className="w-auto items-center gap-1.5">
                  <FieldLabel>목표 평균</FieldLabel>
                  <Input
                    type="number"
                    min="1"
                    max="5"
                    step="0.01"
                    value={currentScoreMean.toFixed(2)}
                    onChange={(event) => updateScoreMean(event.target.value)}
                    disabled={disabled}
                    className="w-20"
                  />
                  <span className="text-sm">점</span>
                </Field>
              )}
            </div>
          )}
          <ToggleGroup
            value={[unit]}
            onValueChange={(value) => {
              if (value[0] === "ratio" || value[0] === "count") setUnit(value[0]);
            }}
            aria-label="목표 표시 단위"
            size="sm"
            variant="outline"
            spacing={0}
          >
            <ToggleGroupItem value="ratio">%</ToggleGroupItem>
            <ToggleGroupItem value="count">명</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex flex-col divide-y">
            {question.options.map((option) => {
              const target = choiceTargetFor(targets, question.id, option.key);
              const ratio = ratios.get(option.key) ?? 0;
              const current = profile?.choices?.[option.key]?.share ?? 0;
              const editable = target !== undefined || editingOptionKey === option.key;
              const value =
                target === undefined
                  ? formatTarget(ratio, unit, targets.targetResponseCount)
                  : undefined;
              const exactValue =
                target !== undefined &&
                (target.target.kind === "ratio" || target.target.kind === "count")
                  ? unit === "ratio"
                    ? target.target.kind === "ratio"
                      ? String(Math.round(target.target.value * 100))
                      : String((target.target.value / targets.targetResponseCount) * 100)
                    : target.target.kind === "count"
                      ? String(target.target.value)
                      : String(Math.round(target.target.value * targets.targetResponseCount))
                  : unit === "ratio"
                    ? String(Math.round(ratio * 100))
                    : String(Math.round(ratio * targets.targetResponseCount));
              return (
                <div
                  key={option.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3"
                >
                  <span className="truncate text-sm">{option.label}</span>
                  <span className="text-sm text-muted-foreground" data-numeric>
                    {Math.round(current * 100)}%
                  </span>
                  {editable ? (
                    <Field orientation="horizontal" className="w-auto items-center gap-1">
                      <FieldLabel className="sr-only">{option.label} 목표</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        max={unit === "ratio" ? 100 : targets.targetResponseCount}
                        value={exactValue}
                        onChange={(event) => setTarget(option.key, event.target.value)}
                        disabled={disabled}
                        className="w-20"
                      />
                      <span className="text-sm">{unit === "ratio" ? "%" : "명"}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setTarget(option.key, "");
                          setEditingOptionKey(null);
                        }}
                        disabled={disabled}
                      >
                        초기화
                      </Button>
                    </Field>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {question.kind === "single_choice" ? (
                        <Tooltip>
                          <TooltipTrigger className="text-sm" data-numeric>
                            {value}
                          </TooltipTrigger>
                          <TooltipContent>
                            남은 비율은 원본 분포를 기준으로 배분됩니다.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-sm" data-numeric>
                          {value}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setEditingOptionKey(option.key)}
                        disabled={disabled}
                      >
                        조정
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {question.kind === "text" && (
        <div className="mt-6 flex flex-col gap-4">
          {(profile?.textClusters?.length ?? 0) > 0 ? (
            <>
              <QuestionDistributionChart data={clusterChartData} unit={unit} />

              <ToggleGroup
                value={[unit]}
                onValueChange={(value) => {
                  if (value[0] === "ratio" || value[0] === "count") setUnit(value[0]);
                }}
                aria-label="목표 표시 단위"
                size="sm"
                variant="outline"
                spacing={0}
              >
                <ToggleGroupItem value="ratio">%</ToggleGroupItem>
                <ToggleGroupItem value="count">명</ToggleGroupItem>
              </ToggleGroup>

              <div className="flex flex-col divide-y">
                {profile!.textClusters!.map((cluster) => {
                  const clusterTarget = textClusterTargetFor(targets, question.id, cluster.id);
                  const editable = clusterTarget !== undefined || editingOptionKey === cluster.id;
                  const value =
                    clusterTarget === undefined
                      ? formatTarget(cluster.share, unit, targets.targetResponseCount)
                      : undefined;
                  const exactValue =
                    clusterTarget !== undefined &&
                    (clusterTarget.target.kind === "ratio" || clusterTarget.target.kind === "count")
                      ? unit === "ratio"
                        ? clusterTarget.target.kind === "ratio"
                          ? String(Math.round(clusterTarget.target.value * 100))
                          : String((clusterTarget.target.value / targets.targetResponseCount) * 100)
                        : clusterTarget.target.kind === "count"
                          ? String(clusterTarget.target.value)
                          : String(Math.round(clusterTarget.target.value * targets.targetResponseCount))
                      : unit === "ratio"
                        ? String(Math.round(cluster.share * 100))
                        : String(Math.round(cluster.share * targets.targetResponseCount));

                  return (
                    <div
                      key={cluster.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm font-medium">{cluster.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          포함: {cluster.memberTexts.slice(0, 3).join(", ")}
                          {cluster.memberTexts.length > 3
                            ? ` 외 ${cluster.memberTexts.length - 3}개`
                            : ""}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground" data-numeric>
                        {Math.round(cluster.share * 100)}%
                      </span>
                      {editable ? (
                        <Field orientation="horizontal" className="w-auto items-center gap-1">
                          <FieldLabel className="sr-only">{cluster.label} 목표</FieldLabel>
                          <Input
                            type="number"
                            min="0"
                            max={unit === "ratio" ? 100 : targets.targetResponseCount}
                            value={exactValue}
                            onChange={(event) => setClusterTarget(cluster, event.target.value)}
                            disabled={disabled}
                            className="w-20"
                          />
                          <span className="text-sm">{unit === "ratio" ? "%" : "명"}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setClusterTarget(cluster, "");
                              setEditingOptionKey(null);
                            }}
                            disabled={disabled}
                          >
                            초기화
                          </Button>
                        </Field>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm" data-numeric>
                            {value}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setEditingOptionKey(cluster.id)}
                            disabled={disabled}
                          >
                            조정
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                분류된 유사 응답 그룹이 아직 없습니다
              </p>
              <p>
                단답형 응답 텍스트를 분석 중이거나 유효 응답 수가 부족한 상태입니다.
                합성 시 원본 풀의 단답형 응답이 안전하게 유지·반영됩니다.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
