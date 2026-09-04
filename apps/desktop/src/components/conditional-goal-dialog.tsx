import { useState } from "react";

import type { ConditionalGoal, FormSnapshot } from "@survey-synth/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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

export type ConditionalGoalDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly form: FormSnapshot;
  readonly onAddGoal: (goal: ConditionalGoal) => void;
};

export function ConditionalGoalDialog({
  open,
  onOpenChange,
  form,
  onAddGoal,
}: ConditionalGoalDialogProps) {
  const [conditionQuestionId, setConditionQuestionId] = useState("");
  const [conditionOptionKey, setConditionOptionKey] = useState("");
  const [outcomeQuestionId, setOutcomeQuestionId] = useState("");
  const [outcomeOptionKey, setOutcomeOptionKey] = useState("");
  const [outcomeValue, setOutcomeValue] = useState("");
  const [outcomeRangeMax, setOutcomeRangeMax] = useState("");
  const [conditionalRange, setConditionalRange] = useState(false);
  const [conditionalUnit, setConditionalUnit] = useState<"ratio" | "count">("ratio");

  const resetDraft = () => {
    setConditionQuestionId("");
    setConditionOptionKey("");
    setOutcomeQuestionId("");
    setOutcomeOptionKey("");
    setOutcomeValue("");
    setOutcomeRangeMax("");
    setConditionalRange(false);
    setConditionalUnit("ratio");
  };

  const conditionQuestions = form.questions.filter(
    (question) => question.kind === "single_choice" || question.kind === "multi_choice",
  );
  const conditionQuestion = conditionQuestions.find(
    (question) => question.id === conditionQuestionId,
  );

  const adjustableQuestions = form.questions.filter(
    (question) =>
      question.kind === "single_choice" ||
      question.kind === "multi_choice" ||
      question.kind === "ordinal" ||
      question.kind === "text",
  );
  const outcomeQuestion = adjustableQuestions.find((question) => question.id === outcomeQuestionId);

  const handleAddGoal = () => {
    if (
      conditionQuestion === undefined ||
      conditionOptionKey === "" ||
      outcomeQuestion === undefined
    )
      return;
    const conditionOption = conditionQuestion.options.find(
      (item) => item.key === conditionOptionKey,
    );
    if (conditionOption === undefined) return;
    const numeric = Number(outcomeValue);
    if (!Number.isFinite(numeric)) return;
    const rangeMax = Number(outcomeRangeMax);
    if (conditionalRange && (!Number.isFinite(rangeMax) || numeric > rangeMax)) return;

    let outcome: ConditionalGoal["outcome"] | undefined;
    if (outcomeQuestion.kind === "single_choice" || outcomeQuestion.kind === "multi_choice") {
      const option = outcomeQuestion.options.find((item) => item.key === outcomeOptionKey);
      if (option === undefined) return;
      outcome = {
        kind: "option",
        questionId: outcomeQuestion.id,
        optionKey: option.key,
        target: conditionalRange
          ? {
              kind: conditionalUnit === "ratio" ? "ratio_range" : "count_range",
              min: conditionalUnit === "ratio" ? numeric / 100 : numeric,
              max: conditionalUnit === "ratio" ? rangeMax / 100 : rangeMax,
            }
          : {
              kind: conditionalUnit,
              value: conditionalUnit === "ratio" ? numeric / 100 : numeric,
            },
      };
    } else if (outcomeQuestion.kind === "ordinal" || outcomeQuestion.kind === "text") {
      outcome = {
        kind: "mean",
        questionId: outcomeQuestion.id,
        target: { kind: "mean", value: numeric },
      };
    }
    if (outcome === undefined) return;

    onAddGoal({
      id: crypto.randomUUID(),
      condition: {
        kind: "option_selected",
        questionId: conditionQuestion.id,
        optionKey: conditionOption.key,
      },
      outcome,
    });
    onOpenChange(false);
    resetDraft();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetDraft();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>조건부 목표</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>조건 문항</FieldLabel>
            <Select
              value={conditionQuestionId || null}
              onValueChange={(value) => {
                setConditionQuestionId(value ?? "");
                setConditionOptionKey("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="문항 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {conditionQuestions.map((question) => (
                    <SelectItem key={question.id} value={question.id}>
                      {question.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {conditionQuestion !== undefined && (
            <Field>
              <FieldLabel>조건 값</FieldLabel>
              <Select
                value={conditionOptionKey || null}
                onValueChange={(value) => setConditionOptionKey(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="값 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {conditionQuestion.options.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel>결과 문항</FieldLabel>
            <Select
              value={outcomeQuestionId || null}
              onValueChange={(value) => {
                setOutcomeQuestionId(value ?? "");
                setOutcomeOptionKey("");
                setOutcomeValue("");
                setOutcomeRangeMax("");
                setConditionalRange(false);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="문항 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {adjustableQuestions
                    .filter((question) => question.id !== conditionQuestionId)
                    .map((question) => (
                      <SelectItem key={question.id} value={question.id}>
                        {question.title}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {outcomeQuestion !== undefined &&
            (outcomeQuestion.kind === "single_choice" ||
              outcomeQuestion.kind === "multi_choice") && (
              <>
                <Field>
                  <FieldLabel>결과 값</FieldLabel>
                  <Select
                    value={outcomeOptionKey || null}
                    onValueChange={(value) => setOutcomeOptionKey(value ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="값 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {outcomeQuestion.options.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <ToggleGroup
                  value={[conditionalUnit]}
                  onValueChange={(value) => {
                    if (value[0] === "ratio" || value[0] === "count")
                      setConditionalUnit(value[0]);
                  }}
                  aria-label="조건부 목표 단위"
                  size="sm"
                  variant="outline"
                  spacing={0}
                >
                  <ToggleGroupItem value="ratio">%</ToggleGroupItem>
                  <ToggleGroupItem value="count">명</ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup
                  value={[conditionalRange ? "range" : "exact"]}
                  onValueChange={(value) => {
                    if (value[0] === "exact" || value[0] === "range") {
                      setConditionalRange(value[0] === "range");
                    }
                  }}
                  aria-label="조건부 목표 유형"
                  size="sm"
                  variant="outline"
                  spacing={0}
                >
                  <ToggleGroupItem value="exact">정확값</ToggleGroupItem>
                  <ToggleGroupItem value="range">범위</ToggleGroupItem>
                </ToggleGroup>
              </>
            )}
          {outcomeQuestion !== undefined && (
            <Field>
              <FieldLabel>
                {outcomeQuestion.kind === "ordinal" || outcomeQuestion.kind === "text"
                  ? "목표 평균"
                  : conditionalRange
                    ? "최소"
                    : "목표"}
              </FieldLabel>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={outcomeValue}
                onChange={(event) => setOutcomeValue(event.target.value)}
              />
            </Field>
          )}
          {conditionalRange &&
            outcomeQuestion !== undefined &&
            (outcomeQuestion.kind === "single_choice" ||
              outcomeQuestion.kind === "multi_choice") && (
              <Field>
                <FieldLabel>최대</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={outcomeRangeMax}
                  onChange={(event) => setOutcomeRangeMax(event.target.value)}
                />
              </Field>
            )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleAddGoal}
            disabled={
              conditionQuestion === undefined ||
              conditionOptionKey === "" ||
              outcomeQuestion === undefined ||
              outcomeValue.trim() === "" ||
              (conditionalRange &&
                (outcomeRangeMax.trim() === "" ||
                  Number(outcomeValue) > Number(outcomeRangeMax))) ||
              ((outcomeQuestion.kind === "single_choice" ||
                outcomeQuestion.kind === "multi_choice") &&
                outcomeOptionKey === "")
            }
          >
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

