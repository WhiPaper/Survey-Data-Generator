import type { RunSummary, RunsGetResult } from "@survey-synth/contracts";

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
import { resultDiagnosticsLines, resultTargetNotice } from "./resultDiagnostics";
import { runBaselineValue } from "./runBaseline";
import { runIntentLabel } from "./runIntent";
import { runPresentationLabel } from "./runPresentation";
import { resultTargetGroups } from "./resultTargetGroups";
import { outcomeValue, type QuestionView } from "./model";

export type RunContext = {
  run: RunsGetResult;
};

type ResultViewProps = {
  contexts: RunContext[];
  summaries: RunSummary[];
  selectedRunId: string;
  questions: QuestionView[];
  exportBusy: boolean;
  onSelectRun: (runId: string) => void;
  onEditTarget: (questionId: string) => void;
  onExport: (format: "csv" | "xlsx") => void;
};

export function ResultView({
  contexts,
  summaries,
  selectedRunId,
  questions,
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

  const targetNotice = resultTargetNotice(context.run);
  const targetGroups = resultTargetGroups(context.run.outcome.targets, context.run.presentations);

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
          <Select value={context.run.runId} onValueChange={(value) => value && onSelectRun(value)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue>
                {summaries.find((summary) => summary.runId === context.run.runId)?.runId ===
                summaries[0]?.runId
                  ? "최신 결과"
                  : new Date(
                      summaries.find((summary) => summary.runId === context.run.runId)?.createdAt ??
                        Date.now(),
                    ).toLocaleString()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {summaries.map((summary, index) => (
                <SelectItem key={summary.runId} value={summary.runId}>
                  {index === 0 ? "최신 결과" : new Date(summary.createdAt).toLocaleString()}
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
        {targetNotice ? <p className="py-5 text-sm text-muted-foreground">{targetNotice}</p> : null}
        {targetGroups.map((group) => (
          <section key={group.questionId} className="py-5">
            <h3 className="text-sm font-medium">{group.questionTitle}</h3>
            <div className="mt-3 space-y-4">
              {group.outcomes.map((outcome) => {
                const baseline = context.run.baselines.find(
                  (candidate) => String(candidate.targetId) === String(outcome.targetId),
                );
                const presentation = context.run.presentations.find(
                  (candidate) => String(candidate.targetId) === String(outcome.targetId),
                );
                const frozenTarget = context.run.targetSnapshot.targets.find(
                  (candidate) => String(candidate.id) === String(outcome.targetId),
                );
                const label = runPresentationLabel(presentation);
                const difference =
                  outcome.kind === "share" || outcome.kind === "conditional_share"
                    ? `${(outcome.absoluteError * 100).toFixed(1)}%p`
                    : outcome.absoluteError.toFixed(2);
                const questionId =
                  presentation &&
                  questions.some((question) => question.id === presentation.questionId)
                    ? presentation.questionId
                    : null;

                return (
                  <div key={String(outcome.targetId)}>
                    <button
                      type="button"
                      className="text-left text-sm font-medium hover:underline"
                      disabled={!questionId}
                      onClick={() => questionId && onEditTarget(questionId)}
                    >
                      {label}
                    </button>
                    <p className="mt-2 text-base tabular-nums">
                      현재 {runBaselineValue(baseline)} →{" "}
                      {runIntentLabel(frozenTarget?.intent, outcome)} → 결과 {outcomeValue(outcome)}
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
          </section>
        ))}
      </div>

      <div className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        {resultDiagnosticsLines(context.run).map((line) => (
          <p key={line} className="mt-1 first:mt-0">
            {line}
          </p>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        과거 결과는 생성 당시 내용으로 보존됩니다.
      </p>
    </div>
  );
}
