import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import type { ProjectTargets } from "@survey-synth/domain";

import { checkTargetFeasibility, updateTargets } from "../api/backend";

export function useTargetDraft({
  projectId,
  serverRevision,
  serverTargets,
}: {
  readonly projectId: string | null;
  readonly serverRevision: number | undefined;
  readonly serverTargets: ProjectTargets | undefined;
}) {
  const queryClient = useQueryClient();
  const targetForm = useForm<ProjectTargets>({
    defaultValues: { targetResponseCount: 0, questionTargets: [] },
    mode: "onChange",
  });
  const draftTargets = useWatch({ control: targetForm.control });
  const targetReady = useRef(false);
  const targetRevision = useRef(0);
  const saveSequence = useRef(0);
  const appliedSaveSequence = useRef(0);
  const targetProjectRef = useRef<string | null>(null);
  const lastSavedTargetsRef = useRef<string | null>(null);

  const targetUpdateMutation = useMutation({
    mutationFn: ({
      projectId: updateProjectId,
      revision,
      targets,
    }: {
      projectId: string;
      revision: number;
      targets: ProjectTargets;
      sequence: number;
    }) => updateTargets(updateProjectId, revision, targets),
    onSuccess: (result, variables) => {
      if (variables.sequence < appliedSaveSequence.current) return;
      appliedSaveSequence.current = variables.sequence;
      queryClient.setQueryData(["targets.get", variables.projectId], (current) => ({
        ...(current as object | undefined),
        revision: result.revision,
        targets: result.targets,
        ...(result.issues === undefined ? {} : { issues: result.issues }),
      }));
      if (variables.projectId !== targetProjectRef.current) return;
      if (result.revision < targetRevision.current) return;
      targetRevision.current = result.revision;
      lastSavedTargetsRef.current = JSON.stringify(result.targets);
    },
  });

  const feasibilityMutation = useMutation({
    mutationFn: (targets: ProjectTargets) => checkTargetFeasibility(projectId ?? "", targets),
  });

  useEffect(() => {
    if (projectId === null || serverRevision === undefined || serverTargets === undefined) return;
    targetReady.current = false;
    targetProjectRef.current = projectId;
    targetRevision.current = serverRevision;
    lastSavedTargetsRef.current = JSON.stringify(serverTargets);
    targetForm.reset(serverTargets);
    targetReady.current = true;
  }, [projectId, serverRevision, serverTargets, targetForm]);

  useEffect(() => {
    if (
      !targetReady.current ||
      targetProjectRef.current !== projectId ||
      projectId === null ||
      !targetForm.formState.isDirty
    )
      return;
    const timer = window.setTimeout(() => {
      const targets = draftTargets as ProjectTargets;
      if (!Number.isInteger(targets.targetResponseCount) || targets.targetResponseCount < 0) return;
      if (JSON.stringify(targets) === lastSavedTargetsRef.current) return;
      targetUpdateMutation.mutate({
        projectId,
        revision: targetRevision.current,
        targets,
        sequence: ++saveSequence.current,
      });
      feasibilityMutation.mutate(targets);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    draftTargets,
    feasibilityMutation,
    projectId,
    targetForm.formState.isDirty,
    targetUpdateMutation,
  ]);

  useEffect(() => {
    const flush = (): void => {
      const targets = targetForm.getValues() as ProjectTargets;
      if (
        projectId === null ||
        targetProjectRef.current !== projectId ||
        !Number.isInteger(targets.targetResponseCount) ||
        JSON.stringify(targets) === lastSavedTargetsRef.current
      )
        return;
      void targetUpdateMutation.mutateAsync({
        projectId,
        revision: targetRevision.current,
        targets,
        sequence: ++saveSequence.current,
      });
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [projectId, targetForm, targetUpdateMutation]);

  const flushTargets = useCallback(async (): Promise<void> => {
    const targets = targetForm.getValues() as ProjectTargets;
    if (
      projectId === null ||
      targetProjectRef.current !== projectId ||
      !Number.isInteger(targets.targetResponseCount) ||
      JSON.stringify(targets) === lastSavedTargetsRef.current
    )
      return;
    await targetUpdateMutation.mutateAsync({
      projectId,
      revision: targetRevision.current,
      targets,
      sequence: ++saveSequence.current,
    });
  }, [projectId, targetForm, targetUpdateMutation]);

  const handleDraftChange = useCallback(
    (targets: ProjectTargets) => targetForm.reset(targets, { keepDirty: true }),
    [targetForm],
  );

  return {
    targetForm,
    draftTargets,
    targetRevision,
    saveSequence,
    targetUpdateMutation,
    feasibilityMutation,
    flushTargets,
    handleDraftChange,
  } as const;
}
