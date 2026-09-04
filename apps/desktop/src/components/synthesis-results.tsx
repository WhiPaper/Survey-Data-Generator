import type { FormSnapshot } from "@survey-synth/domain";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ValidationMetricView = {
  readonly metric: {
    readonly kind: "option_count" | "option_ratio" | "mean" | "selection_count_mean";
    readonly questionId: string;
    readonly optionKey?: string;
  };
  readonly requested: {
    readonly kind: string;
    readonly value?: number;
    readonly min?: number;
    readonly max?: number;
  };
  readonly actual: number | null;
  readonly satisfied: boolean;
};

export type RunDetailView = {
  readonly validation: {
    readonly finalResponseCount: number;
    readonly originalMutationCount: number;
    readonly metrics?: readonly ValidationMetricView[];
    readonly errors?: readonly string[];
  };
  readonly aiMetadata?: {
    readonly generatedCount: number;
  };
};

export type SynthesisResultsViewProps = {
  readonly completedRun: {
    readonly runId: string;
    readonly count: number;
    readonly syntheticCount: number;
  };
  readonly form: FormSnapshot;
  readonly runData: RunDetailView | undefined;
  readonly aiEnabled: boolean;
  readonly aiPending: boolean;
  readonly aiFeedback?: string;
  readonly aiError?: string;
  readonly onStartAi: () => void;
  readonly onCancelAi: () => void;
  readonly onExport: (format: "csv" | "xlsx") => void;
  readonly exportPending: boolean;
  readonly exportFeedback?: string;
  readonly exportError?: string;
  readonly onRegenerate: () => void;
  readonly regeneratePending: boolean;
};

export const formatMetricValue = (
  kind: ValidationMetricView["metric"]["kind"],
  value: number | null | undefined,
): string => {
  if (value === null || value === undefined) return "-";
  if (kind === "option_ratio") return `${Math.round(value * 100)}%`;
  if (kind === "option_count") return `${Math.round(value)}명`;
  return value.toFixed(2);
};

export const formatRequestedTarget = (metric: ValidationMetricView): string => {
  if (metric.requested.kind === "ratio")
    return `${Math.round((metric.requested.value ?? 0) * 100)}%`;
  if (metric.requested.kind === "count") return `${metric.requested.value ?? 0}명`;
  if (metric.requested.kind === "ratio_range")
    return `${Math.round((metric.requested.min ?? 0) * 100)}–${Math.round((metric.requested.max ?? 0) * 100)}%`;
  if (metric.requested.kind === "count_range")
    return `${metric.requested.min ?? 0}–${metric.requested.max ?? 0}명`;
  return `${metric.requested.value?.toFixed(2) ?? "-"}`;
};

export const validationMetricLabel = (
  form: FormSnapshot,
  metric: ValidationMetricView,
): string => {
  const question = form.questions.find((item) => item.id === metric.metric.questionId);
  if (question === undefined) return "삭제된 문항";
  if (metric.metric.optionKey !== undefined) {
    if (question.kind === "single_choice" || question.kind === "multi_choice") {
      const option = question.options.find((item) => item.key === metric.metric.optionKey);
      return option === undefined ? question.title : `${question.title}: ${option.label}`;
    }
  }
  return metric.metric.kind === "selection_count_mean"
    ? `${question.title}: 선택 수 평균`
    : question.title;
};

export function SynthesisResultsView({
  completedRun,
  form,
  runData,
  aiEnabled,
  aiPending,
  aiFeedback,
  aiError,
  onStartAi,
  onCancelAi,
  onExport,
  exportPending,
  exportFeedback,
  exportError,
  onRegenerate,
  regeneratePending,
}: SynthesisResultsViewProps) {
  return (
    <section className="result-summary" aria-labelledby="result-title">
      <h2 id="result-title" className="text-base font-semibold">
        결과
      </h2>
      <p data-numeric className="text-sm">
        {completedRun.syntheticCount}명 증강 (최종 {completedRun.count}명)
      </p>
      {runData !== undefined && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>문항</TableHead>
                <TableHead>목표</TableHead>
                <TableHead>결과</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runData.validation.metrics ?? []).map((metric, index) => (
                <TableRow
                  key={index}
                  data-state={metric.satisfied ? undefined : "selected"}
                >
                  <TableCell>{validationMetricLabel(form, metric)}</TableCell>
                  <TableCell>{formatRequestedTarget(metric)}</TableCell>
                  <TableCell>
                    {formatMetricValue(metric.metric.kind, metric.actual)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Sheet>
            <SheetTrigger render={<Button variant="ghost" size="sm" className="w-fit" />}>
              세부 검증
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>세부 검증</SheetTitle>
              </SheetHeader>
              <dl className="grid gap-3 px-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">최종 응답</dt>
                  <dd data-numeric>{runData.validation.finalResponseCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">원본 변경</dt>
                  <dd data-numeric>{runData.validation.originalMutationCount}</dd>
                </div>
              </dl>
              {Array.isArray(runData.validation.errors) &&
                runData.validation.errors.length > 0 && (
                  <FieldError className="mx-4">
                    {runData.validation.errors.join(" ")}
                  </FieldError>
                )}
            </SheetContent>
          </Sheet>
        </>
      )}
      <div className="ai-actions">
        {aiEnabled &&
          (runData?.aiMetadata ? (
            <span>
              AI 텍스트 채움 완료 ({runData.aiMetadata.generatedCount}개 항목)
            </span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onStartAi}
                disabled={aiPending || exportPending}
              >
                텍스트도 자연스럽게 채우기
              </Button>
              {aiPending && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner aria-hidden="true" />
                  텍스트 채우는 중…
                  <Button variant="ghost" size="sm" onClick={onCancelAi}>
                    취소
                  </Button>
                </span>
              )}
              {aiFeedback && (
                <p role="status" className="text-sm text-muted-foreground">
                  {aiFeedback}
                </p>
              )}
              {aiError && <FieldError>{aiError}</FieldError>}
            </>
          ))}
      </div>
      <div className="export-actions">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport("xlsx")}
          disabled={exportPending}
        >
          Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport("csv")}
          disabled={exportPending}
        >
          CSV
        </Button>
        {exportPending && <Spinner aria-label="저장 중" />}
        {exportFeedback && (
          <p role="status" className="text-sm text-muted-foreground">
            {exportFeedback}
          </p>
        )}
        {exportError && <FieldError>{exportError}</FieldError>}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRegenerate}
        disabled={regeneratePending}
      >
        결과 다시 만들기
      </Button>
    </section>
  );
}

