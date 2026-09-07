import type {
  RunsGetResult,
  TargetDraft,
  TargetProfileResult,
  ValueGroupView,
} from "@survey-synth/contracts";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  currentValue,
  intentLabel,
  outcomeValue,
  questionIdForTarget,
  targetLabel,
  type QuestionView,
} from "./model";

export type RunContext = {
  run: RunsGetResult;
  draft: TargetDraft;
  profile: TargetProfileResult | null;
};

type ResultViewProps = {
  contexts: RunContext[];
  selectedRunId: string;
  questions: QuestionView[];
  groups: ValueGroupView[];
  exportBusy: boolean;
  onSelectRun: (runId: string) => void;
  onEditTarget: (questionId: string) => void;
  onExport: (format: "csv" | "xlsx") => void;
};

export function ResultView({
  contexts,
  selectedRunId,
  questions,
  groups,
  exportBusy,
  onSelectRun,
  onEditTarget,
  onExport,
}: ResultViewProps) {
  const context =
    contexts.find((candidate) => candidate.run.runId === selectedRunId) ?? contexts[0] ?? null;

  if (!context) {
    return (
      <div className="mx-auto max-w-[850px] px-8 py-10">
        <p className="text-sm text-muted-foreground">아직 생성한 결과가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[850px] px-8 py-8">
      <div className="flex items-center justify-between gap-4 border-b pb-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">결과</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            최종 응답 {context.run.finalResponseCount}명
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={context.run.runId} onValueChange={onSelectRun}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contexts.map((candidate, index) => (
                <SelectItem key={candidate.run.runId} value={candidate.run.runId}>
                  {index === 0 ? "최신 결과" : `이전 결과 ${contexts.length - index}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" disabled={exportBusy}>
                  내보내기
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onExport("csv")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("xlsx")}>XLSX</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="divide-y">
        {context.run.outcome.targets.map((outcome) => {
          const target = context.draft.targets.find(
            (candidate) => String(candidate.id) === String(outcome.targetId),
          );
          const label = target ? targetLabel(target, questions, groups) : "목표";
          const difference =
            outcome.kind === "share" || outcome.kind === "conditional_share"
              ? `${(outcome.absoluteError * 100).toFixed(1)}%p`
              : outcome.absoluteError.toFixed(2);
          const questionId = target ? questionIdForTarget(target, groups) : null;

          return (
            <div key={String(outcome.targetId)} className="py-5">
              <button
                type="button"
                className="text-left text-sm font-medium hover:underline"
                disabled={!questionId}
                onClick={() => questionId && onEditTarget(questionId)}
              >
                {label}
              </button>
              <p className="mt-2 text-base tabular-nums">
                현재 {currentValue(target, context.profile)} → {intentLabel(target, outcome)} → 결과{" "}
                {outcomeValue(outcome)}
              </p>
              {!outcome.exact ? (
                <p className="mt-1 text-sm text-muted-foreground">목표와 {difference} 차이</p>
              ) : null}
              {outcome.kind === "conditional_share" &&
              outcome.numeratorCount !== undefined &&
              outcome.denominatorCount !== undefined ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {outcome.numeratorCount}/{outcome.denominatorCount}명
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        현재 backend에는 Run 목록 조회가 없어 이 선택기는 이번 앱 세션에서 생성한 결과만
        표시합니다. 저장된 과거 Run 자체는 변경하지 않습니다.
      </p>
    </div>
  );
}
