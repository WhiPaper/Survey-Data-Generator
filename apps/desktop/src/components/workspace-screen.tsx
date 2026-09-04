import type { ProjectDetailView, TargetMigrationIssueView } from "@survey-synth/contracts";
import type { FormSnapshot, ProjectTargets } from "@survey-synth/domain";

import { ProjectHomeView } from "./project-home";
import { SurveyQuestionEditor } from "./survey-questionnaire";
import { TargetEditor } from "./target-editor";
import type { WorkspaceView } from "@/hooks/use-workspace-route";

export type WorkspaceScreenProps = {
  readonly view: WorkspaceView;
  readonly project: ProjectDetailView;
  readonly sourceCount: number;
  readonly selectedQuestionId: string | null;
  readonly targets: ProjectTargets;
  readonly migrationIssues: readonly TargetMigrationIssueView[];
  readonly targetsInfeasible: boolean;
  readonly targetUpdatePending: boolean;
  readonly synthesisPending: boolean;
  readonly targetError?: string;
  readonly onTargetsChange: (targets: ProjectTargets) => void;
  readonly onGenerate: () => void;
  readonly onTimestampRangeChange: (range: { start: string; end: string }) => void;
};

export function WorkspaceScreen({
  view,
  project,
  sourceCount,
  selectedQuestionId,
  targets,
  migrationIssues,
  targetsInfeasible,
  targetUpdatePending,
  synthesisPending,
  targetError,
  onTargetsChange,
  onGenerate,
  onTimestampRangeChange,
}: WorkspaceScreenProps) {
  const form = project.form as unknown as FormSnapshot;
  const hasBlockingIssues = migrationIssues.some((issue) => issue.severity === "blocking");
  const disabled =
    synthesisPending || targetUpdatePending || targetsInfeasible || hasBlockingIssues;

  if (view === "home") {
    return (
      <ProjectHomeView
        key={project.id}
        form={form}
        projectId={project.id}
        sourceCount={sourceCount}
        targets={targets}
        onChange={onTargetsChange}
        disabled={disabled}
        createdAt={project.createdAt}
        responseTimestampRange={project.responseTimestampRange}
        onTimestampRangeChange={onTimestampRangeChange}
      />
    );
  }

  if (view === "survey") {
    return (
      <SurveyQuestionEditor
        form={form}
        questionId={selectedQuestionId}
        sourceCount={sourceCount}
        fullSourceCount={project.responseCount}
        profiles={project.profiles}
        targets={targets}
        onChange={onTargetsChange}
        disabled={disabled}
      />
    );
  }

  if (view === "targets") {
    return (
      <TargetEditor
        form={form}
        sourceCount={sourceCount}
        targets={targets}
        profiles={project.profiles}
        onChange={onTargetsChange}
        onGenerate={onGenerate}
        disabled={disabled}
        error={targetError}
      />
    );
  }

  return null;
}
