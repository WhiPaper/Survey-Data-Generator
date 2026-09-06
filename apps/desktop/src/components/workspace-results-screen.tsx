import type { FormSnapshot } from "@survey-synth/domain";

import { SynthesisResultsView, type RunDetailView } from "./synthesis-results";

export type WorkspaceResultsScreenProps = {
  readonly completedRun: {
    readonly runId: string;
    readonly count: number;
    readonly syntheticCount: number;
  };
  readonly form: FormSnapshot;
  readonly runData: RunDetailView | undefined;
  readonly exportPending: boolean;
  readonly exportFeedback?: string;
  readonly exportError?: string;
  readonly regeneratePending: boolean;
  readonly onExport: (format: "csv" | "xlsx") => void;
  readonly onRegenerate: () => void;
};

export function WorkspaceResultsScreen({
  completedRun,
  form,
  runData,
  exportPending,
  exportFeedback,
  exportError,
  regeneratePending,
  onExport,
  onRegenerate,
}: WorkspaceResultsScreenProps) {
  return (
    <SynthesisResultsView
      completedRun={completedRun}
      form={form}
      runData={runData}
      onExport={onExport}
      exportPending={exportPending}
      exportFeedback={exportFeedback}
      exportError={exportError}
      onRegenerate={onRegenerate}
      regeneratePending={regeneratePending}
    />
  );
}
