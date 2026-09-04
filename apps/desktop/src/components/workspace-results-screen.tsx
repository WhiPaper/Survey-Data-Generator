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
  readonly aiEnabled: boolean;
  readonly aiPending: boolean;
  readonly aiFeedback?: string;
  readonly aiError?: string;
  readonly exportPending: boolean;
  readonly exportFeedback?: string;
  readonly exportError?: string;
  readonly regeneratePending: boolean;
  readonly onStartAi: () => void;
  readonly onCancelAi: () => void;
  readonly onExport: (format: "csv" | "xlsx") => void;
  readonly onRegenerate: () => void;
};

export function WorkspaceResultsScreen({
  completedRun,
  form,
  runData,
  aiEnabled,
  aiPending,
  aiFeedback,
  aiError,
  exportPending,
  exportFeedback,
  exportError,
  regeneratePending,
  onStartAi,
  onCancelAi,
  onExport,
  onRegenerate,
}: WorkspaceResultsScreenProps) {
  return (
    <SynthesisResultsView
      completedRun={completedRun}
      form={form}
      runData={runData}
      aiEnabled={aiEnabled}
      aiPending={aiPending}
      aiFeedback={aiFeedback}
      aiError={aiError}
      onStartAi={onStartAi}
      onCancelAi={onCancelAi}
      onExport={onExport}
      exportPending={exportPending}
      exportFeedback={exportFeedback}
      exportError={exportError}
      onRegenerate={onRegenerate}
      regeneratePending={regeneratePending}
    />
  );
}
