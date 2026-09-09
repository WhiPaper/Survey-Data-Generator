import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AugmentationCountSpec,
  CompositeResult,
  EditPlanPreview,
  ProjectDetailView,
  ProjectSourceReviewResult,
  RunSummary,
  SourceScope,
  SynthesisTarget,
  TargetDraft,
  TargetDraftTarget,
  TargetIssue,
  TargetProfileResult,
  ValueGroupObservedValue,
  ValueGroupView,
} from "@survey-synth/contracts";

import {
  createValueGroup,
  deleteValueGroup,
  exportRun,
  exportComposite,
  getCompositeDraft,
  getRun,
  getTargetDraft,
  getTargetProfile,
  listRuns,
  listValueGroups,
  listValueGroupValues,
  resolveSynthesisEditPlan,
  saveTargetDraft,
  startComposite,
  resolveCompositeEditPlan,
  saveCompositeDraft,
  validateTargetDraft,
} from "../api/backend";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResultView, type RunContext } from "./ResultView";
import { TextInspector } from "./TextInspector";
import { createDraftSaveCoordinator } from "./draftSaveCoordinator";
import { editPlanOutcomeValue } from "./editPlanPresentation";
import { generationBlockReason } from "./generationPolicy";
import { resolvedCountForMode, targetKindForMode, targetModeAllowed } from "./targetModePolicy";
import { questionPopulationText } from "./questionPopulation";
import { questionExplorerErrorMessage } from "./userFacingError";
import { executeValueGroupRepair } from "./sourceReviewRepair";
import { sourceScopeEditorError, sourceScopesEqual } from "./sourceScopeEditor";
import { recognizeLikertScoreMapping } from "./likertScoreMapping";
import {
  conditionalProfileMetric,
  conditionalTarget,
  conditionalTargetId,
  dependentTargets,
  editingMetric,
  formatShare,
  issueMessage,
  meanMetric,
  meanTarget,
  meanTargetId,
  ordinalDistributionMetric,
  projectQuestions,
  questionIdForTarget,
  subjectMetricFor,
  subjectTarget,
  subjectTargetId,
  targetId,
  targetLabel,
  targetModeFor,
  targetSummary,
  targetValueFor,
  type EditingTarget,
  type QuestionView,
  type TargetMode,
} from "./model";

type WorkspaceView = "setup" | "result";

type EditingMean = {
  questionId: string;
  questionTitle: string;
  min: number;
  max: number;
};

const toDateTimeInput = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const fromDateTimeInput = (value: string): string | null => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const migratedGroupTarget = (
  target: TargetDraftTarget,
  previousId: string,
  nextId: string,
): TargetDraftTarget => {
  if (target.kind === "conditional_share" && target.population.valueGroupId === previousId) {
    return {
      ...target,
      id: conditionalTargetId(nextId, target.questionId, target.optionKey),
      population: { kind: "value_group", valueGroupId: nextId },
    };
  }
  if (
    (target.kind === "share" || target.kind === "count") &&
    target.subject.kind === "value_group" &&
    target.subject.valueGroupId === previousId
  ) {
    return {
      ...target,
      id: targetId(`${target.kind}:value_group:${nextId}`),
      subject: { kind: "value_group", valueGroupId: nextId },
    };
  }
  return target;
};

export function QuestionExplorerPanel({
  project,
  sourceReview,
  onDraftFlushReady,
}: {
  project: ProjectDetailView;
  sourceReview?: ProjectSourceReviewResult | null;
  onDraftFlushReady?: (flush: (() => Promise<void>) | null) => void;
}) {
  const questions = useMemo(() => projectQuestions(project), [project]);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("setup");
  const [selectedQuestionId, setSelectedQuestionId] = useState(questions[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [targetOnly, setTargetOnly] = useState(false);
  const [draft, setDraft] = useState<TargetDraft>({
    projectId: project.id,
    finalCount: project.responseCount + 40,
    sourceScope: { kind: "all" },
    seed: 42,
    targets: [],
  });
  const [ruleIds, setRuleIds] = useState<string[]>(["rule-1"]);
  const [ruleDrafts, setRuleDrafts] = useState<TargetDraft[]>([]);
  const [ruleCounts, setRuleCounts] = useState<AugmentationCountSpec[]>([
    { kind: "final", value: project.responseCount + 40 },
  ]);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [composite, setComposite] = useState<CompositeResult | null>(null);
  const [compositeEditPlan, setCompositeEditPlan] = useState<{
    batchId: string;
    planId: string;
    ruleId: string;
    preview: EditPlanPreview;
  } | null>(null);
  const [profile, setProfile] = useState<TargetProfileResult | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [scopeApplyBusy, setScopeApplyBusy] = useState(false);
  const [scopeEditor, setScopeEditor] = useState<SourceScope>({ kind: "all" });
  const [groups, setGroups] = useState<ValueGroupView[]>([]);
  const [textValues, setTextValues] = useState<ValueGroupObservedValue[]>([]);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [editingMean, setEditingMean] = useState<EditingMean | null>(null);
  const [mode, setMode] = useState<TargetMode>("absolute_share");
  const [value, setValue] = useState("");
  const [meanValue, setMeanValue] = useState("");
  const [populationGroupId, setPopulationGroupId] = useState("all");
  const [deleteBlockedGroup, setDeleteBlockedGroup] = useState<ValueGroupView | null>(null);
  const [sourceReviewOpen, setSourceReviewOpen] = useState(false);
  const [sourceTargetIssues, setSourceTargetIssues] = useState<TargetIssue[]>(
    sourceReview?.targetIssues ?? [],
  );
  const [issues, setIssues] = useState<TargetIssue[]>([]);
  const [editPlan, setEditPlan] = useState<{
    planId: string;
    preview: EditPlanPreview;
  } | null>(null);
  const [runContexts, setRunContexts] = useState<RunContext[]>([]);
  const [runSummaries, setRunSummaries] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftSaveCoordinator = useMemo(
    () => createDraftSaveCoordinator(saveTargetDraft),
    [project.id],
  );

  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ?? questions[0];
  const scoreMappings = useMemo(
    () =>
      draft.targets.flatMap((target) =>
        target.kind === "mean" && target.scoreMapping ? [target.scoreMapping] : [],
      ),
    [draft.targets],
  );
  const selectedLikertMapping = selectedQuestion
    ? recognizeLikertScoreMapping(selectedQuestion)
    : null;
  const selectedScoreMapping = selectedQuestion
    ? meanTarget(draft.targets, selectedQuestion.id)?.scoreMapping
    : undefined;
  const selectedIsScoreQuestion = selectedQuestion?.kind === "ordinal" || !!selectedScoreMapping;
  const activeReviewGroups = (sourceReview?.invalidValueGroupIds ?? [])
    .map((groupId) => groups.find((group) => group.id === groupId))
    .filter((group): group is ValueGroupView => group !== undefined);
  const activeReviewTargetIssues = sourceTargetIssues.filter(
    (issue) =>
      issue.targetIds.length === 0 ||
      issue.targetIds.some((issueTargetId) =>
        draft.targets.some((target) => String(target.id) === String(issueTargetId)),
      ),
  );
  const sourceReviewCount = activeReviewGroups.length + activeReviewTargetIssues.length;
  const reviewQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of activeReviewGroups) ids.add(group.questionId);
    for (const issue of activeReviewTargetIssues) {
      for (const issueTargetId of issue.targetIds) {
        const target = draft.targets.find(
          (candidate) => String(candidate.id) === String(issueTargetId),
        );
        const questionId = target ? questionIdForTarget(target, groups) : null;
        if (questionId) ids.add(questionId);
      }
    }
    return ids;
  }, [activeReviewGroups, activeReviewTargetIssues, draft.targets, groups]);

  const reloadGroups = async (): Promise<ValueGroupView[]> => {
    const nextGroups = await listValueGroups(project.id);
    setGroups(nextGroups);
    return nextGroups;
  };

  const reloadProfile = async (sourceScope: SourceScope): Promise<TargetProfileResult> => {
    const nextProfile = await getTargetProfile(project.id, sourceScope, scoreMappings);
    setProfile(nextProfile);
    return nextProfile;
  };

  useEffect(() => {
    setSelectedQuestionId((current) =>
      questions.some((question) => question.id === current) ? current : (questions[0]?.id ?? ""),
    );
  }, [questions]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    setWorkspaceView("setup");
    setRunContexts([]);
    setRunSummaries([]);
    setSelectedRunId("");

    void Promise.all([
      getTargetDraft(project.id),
      listValueGroups(project.id),
      listRuns(project.id),
      getCompositeDraft(project.id),
    ])
      .then(async ([saved, nextGroups, nextRunSummaries, savedBatch]) => {
        if (!active) return;
        const nextDraft: TargetDraft = saved
          ? {
              projectId: saved.projectId,
              finalCount: saved.finalCount,
              sourceScope: saved.sourceScope,
              seed: saved.seed,
              targets: Array.isArray(saved.targets) ? saved.targets : [],
            }
          : {
              projectId: project.id,
              finalCount: project.responseCount + 40,
              sourceScope: { kind: "all" },
              seed: 42,
              targets: [],
            };
        draftSaveCoordinator.setLatest(nextDraft, saved !== null);
        setDraft(nextDraft);
        const batchRules = savedBatch?.rules ?? [
          {
            ruleId: "rule-1",
            draft: nextDraft,
            count: {
              kind: "final" as const,
              value: nextDraft.finalCount ?? project.responseCount + 40,
            },
          },
        ];
        const selected = batchRules[0]!;
        setRuleIds(batchRules.map((rule) => rule.ruleId));
        setRuleDrafts(batchRules.map((rule) => rule.draft));
        setRuleCounts(batchRules.map((rule) => rule.count));
        setSelectedRuleIndex(0);
        setDraft(selected.draft);
        setScopeEditor(selected.draft.sourceScope);
        setScopeEditor(nextDraft.sourceScope);
        setGroups(nextGroups);
        setRunSummaries(nextRunSummaries);
        setProfile(await getTargetProfile(project.id, nextDraft.sourceScope, []));
        if (active) setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(questionExplorerErrorMessage(cause, "load_workspace"));
      });

    return () => {
      active = false;
    };
  }, [draftSaveCoordinator, project.currentSourceRevisionId, project.id, project.responseCount]);

  useEffect(() => {
    setSourceTargetIssues(sourceReview?.targetIssues ?? []);
    setSourceReviewOpen(false);
  }, [sourceReview?.sourceRevisionId]);

  useEffect(() => {
    if (!loaded || !sourceReview) return;
    const timer = window.setTimeout(() => {
      void validateTargetDraft(draft)
        .then((result) => setSourceTargetIssues(result.issues))
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, sourceReview?.sourceRevisionId]);

  useEffect(() => {
    if (!loaded) return;
    draftSaveCoordinator.setLatest(draft);
    const timer = window.setTimeout(() => {
      void draftSaveCoordinator.flush().catch((cause: unknown) => {
        setError(questionExplorerErrorMessage(cause, "save_draft"));
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, draftSaveCoordinator, loaded]);

  const flushDraft = useCallback(async (): Promise<void> => {
    if (!loaded) return;
    draftSaveCoordinator.setLatest(draft);
    await draftSaveCoordinator.flush();
  }, [draft, draftSaveCoordinator, loaded]);

  useEffect(() => {
    onDraftFlushReady?.(flushDraft);
    return () => onDraftFlushReady?.(null);
  }, [flushDraft, onDraftFlushReady]);

  useEffect(() => {
    if (!loaded) return;
    let active = true;
    setProfileBusy(true);
    void getTargetProfile(project.id, draft.sourceScope, scoreMappings)
      .then((nextProfile) => {
        if (active) setProfile(nextProfile);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(questionExplorerErrorMessage(cause, "reload_distribution"));
      })
      .finally(() => {
        if (active) setProfileBusy(false);
      });
    return () => {
      active = false;
    };
  }, [draft.sourceScope, loaded, project.id, scoreMappings]);

  // The existing target editor operates on `draft`; retain one independent
  // snapshot per rule and swap it when the selected rule changes.
  useEffect(() => {
    if (!loaded) return;
    setRuleDrafts((current) => {
      if (current.length === 0 || selectedRuleIndex >= current.length) return current;
      const next = [...current];
      next[selectedRuleIndex] = draft;
      return next;
    });
  }, [draft, loaded, selectedRuleIndex]);

  useEffect(() => {
    if (!loaded || ruleDrafts.length === 0 || ruleDrafts.length !== ruleIds.length) return;
    const timer = window.setTimeout(() => {
      void saveCompositeDraft({
        projectId: project.id,
        rules: ruleDrafts.map((rule, index) => ({
          ruleId: ruleIds[index]!,
          draft: index === selectedRuleIndex ? draft : rule,
          count: ruleCounts[index]!,
        })),
      }).catch((cause: unknown) => setError(questionExplorerErrorMessage(cause, "save_draft")));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, project.id, ruleCounts, ruleDrafts, ruleIds, selectedRuleIndex]);

  useEffect(() => {
    if (selectedQuestion?.kind !== "text") {
      setTextValues([]);
      return;
    }
    let active = true;
    void listValueGroupValues(project.id, selectedQuestion.id)
      .then((values) => {
        if (active) setTextValues(values);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(questionExplorerErrorMessage(cause, "load_text_values"));
      });
    return () => {
      active = false;
    };
  }, [project.id, selectedQuestion?.id, selectedQuestion?.kind]);

  const targetCountFor = (questionId: string): number =>
    draft.targets.filter((target) => questionIdForTarget(target, groups) === questionId).length;

  const filteredQuestions = questions.filter((question) => {
    const matchesSearch = question.title
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
    return matchesSearch && (!targetOnly || targetCountFor(question.id) > 0);
  });

  const sourceCount = profile?.responseCount ?? project.responseCount;
  const sourceScopeDirty = !sourceScopesEqual(scopeEditor, draft.sourceScope);
  const sourceScopeError = sourceScopeEditorError(scopeEditor);
  const finalCount = draft.finalCount;
  const generationBlock = generationBlockReason({
    sourceCount,
    finalCount,
    targetCount: draft.targets.length,
  });
  const finalCountInvalid = generationBlock === "final_count_below_source";
  const noAdditionalResponses = generationBlock === "no_additions";
  const additions = finalCountInvalid || finalCount === null ? null : finalCount - sourceCount;

  const directTarget = editing ? subjectTarget(draft.targets, editing) : undefined;
  const conditional =
    editing?.subjectKind === "checkbox_option" && editing.optionKey && populationGroupId !== "all"
      ? conditionalTarget(draft.targets, populationGroupId, editing.questionId, editing.optionKey)
      : undefined;
  const currentTarget = populationGroupId === "all" ? directTarget : conditional;
  const currentMetric = editingMetric(profile, editing);
  const conditionalMode = editing?.subjectKind === "checkbox_option" && populationGroupId !== "all";
  const currentConditionalMetric =
    conditionalMode && editing?.optionKey
      ? conditionalProfileMetric(profile, populationGroupId, editing.questionId, editing.optionKey)
      : undefined;
  const activeMetric = conditionalMode ? currentConditionalMetric : currentMetric;
  const parsedValue = Number(value);
  const shareMode =
    mode === "absolute_share" ||
    mode === "percentage_point_delta" ||
    mode === "relative_percent_delta";
  const resolvedShare =
    activeMetric && Number.isFinite(parsedValue)
      ? mode === "absolute_share"
        ? parsedValue / 100
        : mode === "percentage_point_delta"
          ? activeMetric.share + parsedValue / 100
          : mode === "relative_percent_delta"
            ? activeMetric.share * (1 + parsedValue / 100)
            : null
      : null;
  const resolvedCount =
    activeMetric && Number.isFinite(parsedValue)
      ? resolvedCountForMode(mode, activeMetric.count, parsedValue)
      : null;
  const valueInvalid =
    value === "" ||
    !Number.isFinite(parsedValue) ||
    !targetModeAllowed(mode, conditionalMode) ||
    (mode === "absolute_share" && (parsedValue < 0 || parsedValue > 100)) ||
    (shareMode &&
      mode !== "absolute_share" &&
      activeMetric !== undefined &&
      (resolvedShare === null || resolvedShare < 0 || resolvedShare > 1)) ||
    (mode === "absolute_count" &&
      (!Number.isInteger(parsedValue) ||
        parsedValue < 0 ||
        (finalCount !== null && parsedValue > finalCount))) ||
    (mode === "count_delta" &&
      (!Number.isInteger(parsedValue) ||
        (currentMetric !== undefined && currentMetric.count + parsedValue < 0) ||
        (currentMetric !== undefined &&
          finalCount !== null &&
          currentMetric.count + parsedValue > finalCount)));

  const parsedMean = Number(meanValue);
  const meanValueInvalid =
    !editingMean ||
    meanValue === "" ||
    !Number.isFinite(parsedMean) ||
    parsedMean < editingMean.min ||
    parsedMean > editingMean.max;
  const currentMeanTarget = editingMean
    ? meanTarget(draft.targets, editingMean.questionId)
    : undefined;
  const currentMeanMetric = editingMean ? meanMetric(profile, editingMean.questionId) : undefined;

  const selectedOrdinalDistribution =
    selectedIsScoreQuestion && selectedQuestion
      ? ordinalDistributionMetric(profile, selectedQuestion.id)
      : undefined;

  const openTarget = (editingTarget: EditingTarget) => {
    const direct = subjectTarget(draft.targets, editingTarget);
    const firstConditional =
      editingTarget.subjectKind === "checkbox_option" && editingTarget.optionKey
        ? draft.targets.find(
            (target): target is Extract<TargetDraftTarget, { kind: "conditional_share" }> =>
              target.kind === "conditional_share" &&
              target.questionId === editingTarget.questionId &&
              target.optionKey === editingTarget.optionKey,
          )
        : undefined;
    const nextPopulation = direct ? "all" : (firstConditional?.population.valueGroupId ?? "all");
    const existing = direct ?? firstConditional;
    setEditing(editingTarget);
    setPopulationGroupId(nextPopulation);
    setMode(targetModeFor(existing));
    setValue(targetValueFor(existing));
  };

  const openOptionTarget = (
    question: QuestionView,
    subjectKind: "option" | "checkbox_option",
    optionKey: string,
    label: string,
  ) => {
    openTarget({
      subjectKind,
      questionId: question.id,
      questionTitle: question.title,
      label,
      optionKey,
    });
  };

  const changePopulation = (nextPopulation: string) => {
    if (!editing || editing.subjectKind !== "checkbox_option" || !editing.optionKey) return;
    const existing =
      nextPopulation === "all"
        ? subjectTarget(draft.targets, editing)
        : conditionalTarget(draft.targets, nextPopulation, editing.questionId, editing.optionKey);
    setPopulationGroupId(nextPopulation);
    setMode(targetModeFor(existing));
    setValue(targetValueFor(existing));
  };

  const commitTarget = () => {
    if (!editing || valueInvalid) return;
    const kind = targetKindForMode(mode);
    const normalized = kind === "share" ? parsedValue / 100 : Math.trunc(parsedValue);
    const intent =
      mode === "percentage_point_delta"
        ? ({ kind: "percentage_point_delta", value: normalized } as const)
        : mode === "relative_percent_delta"
          ? ({ kind: "relative_percent_delta", value: normalized } as const)
          : mode === "count_delta"
            ? ({ kind: "count_delta", value: normalized } as const)
            : ({ kind: "absolute", value: normalized } as const);

    let nextTarget: TargetDraftTarget;
    if (
      editing.subjectKind === "checkbox_option" &&
      editing.optionKey &&
      populationGroupId !== "all"
    ) {
      nextTarget = {
        id: conditionalTargetId(populationGroupId, editing.questionId, editing.optionKey),
        kind: "conditional_share",
        population: { kind: "value_group", valueGroupId: populationGroupId },
        questionId: editing.questionId,
        optionKey: editing.optionKey,
        intent,
      };
    } else {
      const subject =
        editing.subjectKind === "value_group"
          ? ({ kind: "value_group", valueGroupId: editing.valueGroupId ?? "" } as const)
          : editing.subjectKind === "option"
            ? ({
                kind: "option",
                questionId: editing.questionId,
                optionKey: editing.optionKey ?? "",
              } as const)
            : ({
                kind: "checkbox_option",
                questionId: editing.questionId,
                optionKey: editing.optionKey ?? "",
              } as const);
      nextTarget = {
        id: subjectTargetId(kind, editing),
        kind,
        subject,
        intent,
      };
    }

    setDraft((current) => ({
      ...current,
      targets: [
        ...current.targets.filter((target) => {
          if (
            editing.subjectKind === "checkbox_option" &&
            editing.optionKey &&
            populationGroupId !== "all"
          ) {
            return !(
              target.kind === "conditional_share" &&
              target.population.valueGroupId === populationGroupId &&
              target.questionId === editing.questionId &&
              target.optionKey === editing.optionKey
            );
          }
          if (target.kind !== "share" && target.kind !== "count") return true;
          if (editing.subjectKind === "value_group") {
            return !(
              target.subject.kind === "value_group" &&
              target.subject.valueGroupId === editing.valueGroupId
            );
          }
          return !(
            target.subject.kind === editing.subjectKind &&
            target.subject.questionId === editing.questionId &&
            target.subject.optionKey === editing.optionKey
          );
        }),
        nextTarget,
      ],
    }));
    setEditing(null);
  };

  const removeTarget = () => {
    if (!editing) return;
    setDraft((current) => ({
      ...current,
      targets: current.targets.filter((target) => {
        if (
          editing.subjectKind === "checkbox_option" &&
          editing.optionKey &&
          populationGroupId !== "all"
        ) {
          return !(
            target.kind === "conditional_share" &&
            target.population.valueGroupId === populationGroupId &&
            target.questionId === editing.questionId &&
            target.optionKey === editing.optionKey
          );
        }
        if (target.kind !== "share" && target.kind !== "count") return true;
        if (editing.subjectKind === "value_group") {
          return !(
            target.subject.kind === "value_group" &&
            target.subject.valueGroupId === editing.valueGroupId
          );
        }
        return !(
          target.subject.kind === editing.subjectKind &&
          target.subject.questionId === editing.questionId &&
          target.subject.optionKey === editing.optionKey
        );
      }),
    }));
    setEditing(null);
  };

  const openMeanTarget = (question: QuestionView) => {
    const mapping = meanTarget(draft.targets, question.id)?.scoreMapping;
    const min = question.min ?? (mapping ? 1 : undefined);
    const max = question.max ?? (mapping ? 5 : undefined);
    if (min === undefined || max === undefined) return;
    const existing = meanTarget(draft.targets, question.id);
    setEditingMean({
      questionId: question.id,
      questionTitle: question.title,
      min,
      max,
    });
    setMeanValue(existing?.intent ? String(existing.intent.value) : "");
  };

  const commitMeanTarget = () => {
    if (!editingMean || meanValueInvalid) return;
    const nextTarget: TargetDraftTarget = {
      id: meanTargetId(editingMean.questionId),
      kind: "mean",
      questionId: editingMean.questionId,
      intent: { kind: "absolute", value: parsedMean },
      ...(meanTarget(draft.targets, editingMean.questionId)?.scoreMapping
        ? { scoreMapping: meanTarget(draft.targets, editingMean.questionId)!.scoreMapping }
        : {}),
    };
    setDraft((current) => ({
      ...current,
      targets: [
        ...current.targets.filter(
          (target) => !(target.kind === "mean" && target.questionId === editingMean.questionId),
        ),
        nextTarget,
      ],
    }));
    setEditingMean(null);
  };

  const removeMeanTarget = () => {
    if (!editingMean) return;
    setDraft((current) => ({
      ...current,
      targets: current.targets.filter(
        (target) => !(target.kind === "mean" && target.questionId === editingMean.questionId),
      ),
    }));
    setEditingMean(null);
  };

  const saveGroup = async (
    previous: ValueGroupView | null,
    name: string,
    members: string[],
  ): Promise<void> => {
    setGroupBusy(true);
    setError(null);
    let created: ValueGroupView | null = null;
    let migrated = false;
    try {
      created = await createValueGroup({
        projectId: project.id,
        questionId: selectedQuestion?.id ?? previous?.questionId ?? "",
        name,
        members,
      });
      if (previous) {
        const nextDraft: TargetDraft = {
          ...draft,
          targets: draft.targets.map((target) =>
            migratedGroupTarget(target, previous.id, created!.id),
          ),
        };
        draftSaveCoordinator.setLatest(nextDraft);
        try {
          await draftSaveCoordinator.flush();
        } catch (cause: unknown) {
          draftSaveCoordinator.setLatest(draft);
          throw cause;
        }
        migrated = true;
        setDraft(nextDraft);
        await deleteValueGroup(previous.id);
      }
      await reloadGroups();
      await reloadProfile(draft.sourceScope);
    } catch (cause: unknown) {
      if (created && previous && !migrated) {
        void deleteValueGroup(created.id).catch(() => undefined);
      }
      if (migrated) void reloadGroups().catch(() => undefined);
      setError(questionExplorerErrorMessage(cause, "save_group"));
      throw cause;
    } finally {
      setGroupBusy(false);
    }
  };

  const requestDeleteGroup = (group: ValueGroupView) => {
    if (dependentTargets(draft.targets, group.id).length > 0) {
      setDeleteBlockedGroup(group);
      return;
    }
    setGroupBusy(true);
    setError(null);
    void deleteValueGroup(group.id)
      .then(async () => {
        await reloadGroups();
        await reloadProfile(draft.sourceScope);
      })
      .catch((cause: unknown) => {
        setError(questionExplorerErrorMessage(cause, "delete_group"));
      })
      .finally(() => setGroupBusy(false));
  };

  const repairReviewGroup = async (group: ValueGroupView): Promise<void> => {
    const dependencyCount = dependentTargets(draft.targets, group.id).length;
    setGroupBusy(true);
    setError(null);
    let draftSaved = dependencyCount === 0;
    let groupDeleted = false;

    try {
      const plan = await executeValueGroupRepair({
        draft,
        valueGroupId: group.id,
        persistDraft: async (nextDraft) => {
          draftSaveCoordinator.setLatest(nextDraft);
          try {
            await draftSaveCoordinator.flush();
          } catch (cause: unknown) {
            draftSaveCoordinator.setLatest(draft);
            throw cause;
          }
          draftSaved = true;
          setDraft(nextDraft);
        },
        deleteGroup: async (valueGroupId) => {
          await deleteValueGroup(valueGroupId);
          groupDeleted = true;
        },
      });

      if (plan.removedTargetIds.length > 0) setDraft(plan.draft);
      await reloadGroups();
      await reloadProfile(plan.draft.sourceScope);
      setSourceReviewOpen(false);
    } catch {
      if (!draftSaved && dependencyCount > 0) {
        setError("연결된 목표 변경사항을 저장하지 못해 그룹을 삭제하지 않았습니다.");
      } else if (!groupDeleted) {
        setError(
          dependencyCount > 0
            ? "연결된 목표는 제거했지만 그룹을 삭제하지 못했습니다. 다시 시도해주세요."
            : "그룹을 삭제하지 못했습니다.",
        );
      } else {
        setError("그룹은 정리했지만 화면을 새로고치지 못했습니다.");
      }
    } finally {
      setGroupBusy(false);
    }
  };

  const navigateToGroupDependency = () => {
    if (!deleteBlockedGroup) return;
    const dependency = dependentTargets(draft.targets, deleteBlockedGroup.id)[0];
    const questionId = dependency
      ? (questionIdForTarget(dependency, groups) ?? deleteBlockedGroup.questionId)
      : deleteBlockedGroup.questionId;
    setSelectedQuestionId(questionId);
    setWorkspaceView("setup");
    setDeleteBlockedGroup(null);
  };

  const setSourceScopeKind = (kind: "all" | "submitted_between") => {
    if (kind === "all") {
      setScopeEditor({ kind: "all" });
      return;
    }
    const fallbackStart = project.responseTimestampRange?.start ?? new Date().toISOString();
    const fallbackEnd = project.responseTimestampRange?.end ?? fallbackStart;
    setScopeEditor((current) =>
      current.kind === "submitted_between"
        ? current
        : draft.sourceScope.kind === "submitted_between"
          ? draft.sourceScope
          : { kind: "submitted_between", start: fallbackStart, end: fallbackEnd },
    );
  };

  const updateScopeDate = (field: "start" | "end", input: string) => {
    const iso = fromDateTimeInput(input);
    if (!iso) return;
    setScopeEditor((current) =>
      current.kind === "submitted_between" ? { ...current, [field]: iso } : current,
    );
  };

  const applySourceScope = async (): Promise<void> => {
    if (!sourceScopeDirty || sourceScopeError) return;
    setScopeApplyBusy(true);
    setProfileBusy(true);
    setError(null);
    try {
      const nextProfile = await getTargetProfile(project.id, scopeEditor, scoreMappings);
      setProfile(nextProfile);
      setScopeEditor(nextProfile.sourceScope);
      setDraft((current) => ({ ...current, sourceScope: nextProfile.sourceScope }));
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "reload_distribution"));
    } finally {
      setScopeApplyBusy(false);
      setProfileBusy(false);
    }
  };

  const selectRun = async (runId: string): Promise<void> => {
    const existing = runContexts.find((context) => context.run.runId === runId);
    if (existing) {
      setSelectedRunId(runId);
      setWorkspaceView("result");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const run = await getRun(runId);
      setRunContexts((current) => [
        { run },
        ...current.filter((context) => context.run.runId !== runId),
      ]);
      setSelectedRunId(runId);
      setWorkspaceView("result");
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "load_result"));
    } finally {
      setBusy(false);
    }
  };

  const recordRun = async (runId: string): Promise<void> => {
    const run = await getRun(runId);
    setRunContexts((current) => [
      { run },
      ...current.filter((context) => context.run.runId !== runId),
    ]);
    setSelectedRunId(runId);
    setWorkspaceView("result");
    void listRuns(project.id)
      .then(setRunSummaries)
      .catch(() => undefined);
  };

  const selectRule = (index: number) => {
    const next = ruleDrafts[index];
    if (!next) return;
    setSelectedRuleIndex(index);
    setDraft(next);
    setScopeEditor(next.sourceScope);
    setIssues([]);
  };

  const addRule = () => {
    const nextIndex = ruleIds.length;
    const nextDraft: TargetDraft = {
      ...draft,
      targets: [],
      sourceScope: { kind: "all" },
      finalCount: project.responseCount + 40,
      seed: draft.seed + nextIndex,
    };
    setRuleIds((current) => [...current, `rule-${nextIndex + 1}`]);
    setRuleDrafts((current) => [...current, nextDraft]);
    setRuleCounts((current) => [...current, { kind: "add", value: 40 }]);
    setSelectedRuleIndex(nextIndex);
    setDraft(nextDraft);
    setScopeEditor(nextDraft.sourceScope);
  };

  const deleteRule = () => {
    if (ruleIds.length <= 1) return;
    const nextIds = ruleIds.filter((_, index) => index !== selectedRuleIndex);
    const nextDrafts = ruleDrafts.filter((_, index) => index !== selectedRuleIndex);
    const nextCounts = ruleCounts.filter((_, index) => index !== selectedRuleIndex);
    const nextIndex = Math.max(0, selectedRuleIndex - 1);
    setRuleIds(nextIds);
    setRuleDrafts(nextDrafts);
    setRuleCounts(nextCounts);
    setSelectedRuleIndex(nextIndex);
    setDraft(nextDrafts[nextIndex]!);
    setScopeEditor(nextDrafts[nextIndex]!.sourceScope);
  };

  const generateBatch = async (): Promise<void> => {
    const drafts = ruleDrafts.map((candidate, index) =>
      index === selectedRuleIndex ? draft : candidate,
    );
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const result = await startComposite({
        projectId: project.id,
        overlapPolicy: "reject",
        rules: drafts.map((rule, index) => ({
          ruleId: ruleIds[index]!,
          sourceScope: rule.sourceScope,
          count: ruleCounts[index]!,
          targets: rule.targets.flatMap<SynthesisTarget>((target) => {
            if (!target.intent) return [];
            if (target.kind === "mean") {
              return [
                {
                  id: target.id,
                  kind: "mean" as const,
                  questionId: target.questionId,
                  value: target.intent.value,
                  ...(target.scoreMapping ? { scoreMapping: target.scoreMapping } : {}),
                },
              ];
            }
            if (target.kind === "conditional_share") {
              return [
                {
                  id: target.id,
                  kind: "conditional_share" as const,
                  population: target.population,
                  questionId: target.questionId,
                  optionKey: target.optionKey,
                  value: target.intent.value,
                },
              ];
            }
            return [
              {
                id: target.id,
                kind: target.kind,
                subject: target.subject,
                value: target.intent.value,
              },
            ];
          }),
          targetIntents: rule.targets.flatMap((target) =>
            target.intent ? [{ targetId: target.id, intent: target.intent }] : [],
          ),
          scoreMappings: rule.targets.flatMap((target) =>
            target.kind === "mean" && target.scoreMapping ? [target.scoreMapping] : [],
          ),
          seed: rule.seed,
        })),
      });
      if (result.status === "success") {
        setComposite(result.composite);
        setMessage(`규칙 ${result.composite.children.length}개를 포함한 결과를 만들었습니다.`);
      } else if (result.status === "approval_required") {
        setCompositeEditPlan({
          batchId: result.batchId,
          planId: result.planId,
          ruleId: result.ruleId,
          preview: result.editPlan,
        });
      } else {
        setIssues(result.issues);
      }
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "generate"));
    } finally {
      setBusy(false);
    }
  };

  const resolveCompositePlan = async (choice: "append_only" | "replacement") => {
    if (!compositeEditPlan) return;
    setBusy(true);
    try {
      const result = await resolveCompositeEditPlan(compositeEditPlan.batchId, choice);
      setCompositeEditPlan(null);
      if (result.status === "success") {
        setComposite(result.composite);
        setMessage(`규칙 ${result.composite.children.length}개를 포함한 결과를 만들었습니다.`);
      } else if (result.status === "approval_required") {
        setCompositeEditPlan({
          batchId: result.batchId,
          planId: result.planId,
          ruleId: result.ruleId,
          preview: result.editPlan,
        });
      } else setIssues(result.issues);
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "complete_generation"));
    } finally {
      setBusy(false);
    }
  };

  const resolveEditPlan = async (choice: "append_only" | "replacement"): Promise<void> => {
    if (!editPlan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resolveSynthesisEditPlan(editPlan.planId, choice);
      setEditPlan(null);
      await recordRun(result.runId);
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "complete_generation"));
    } finally {
      setBusy(false);
    }
  };

  const removeReviewTargets = (issue: TargetIssue) => {
    const ids = new Set(issue.targetIds.map(String));
    setDraft((current) => ({
      ...current,
      targets: current.targets.filter((target) => !ids.has(String(target.id))),
    }));
  };

  const navigateToIssue = (issue: TargetIssue) => {
    const targetIdValue = issue.targetIds[0];
    const target = targetIdValue
      ? draft.targets.find((candidate) => String(candidate.id) === String(targetIdValue))
      : undefined;
    if (target) {
      const questionId = questionIdForTarget(target, groups);
      if (questionId) setSelectedQuestionId(questionId);
    }
    setIssues([]);
    setWorkspaceView("setup");
  };

  const exportSelectedRun = async (format: "csv" | "xlsx"): Promise<void> => {
    const context =
      runContexts.find((candidate) => candidate.run.runId === selectedRunId) ?? runContexts[0];
    if (!context) return;
    setExportBusy(true);
    setError(null);
    try {
      const result = await exportRun(context.run.runId, format);
      if (result.status === "saved") setMessage(`${format.toUpperCase()} 파일을 저장했습니다.`);
    } catch (cause: unknown) {
      setError(questionExplorerErrorMessage(cause, "export_result"));
    } finally {
      setExportBusy(false);
    }
  };

  const renderChoiceRows = (question: QuestionView, subjectKind: "option" | "checkbox_option") => (
    <div className="mt-7 space-y-1">
      {question.options.map((option) => {
        const metric = subjectMetricFor(profile, subjectKind, question.id, option.key);
        const currentShare = metric?.share ?? 0;
        const editingTarget: EditingTarget = {
          subjectKind,
          questionId: question.id,
          questionTitle: question.title,
          label: option.label,
          optionKey: option.key,
        };
        const target = subjectTarget(draft.targets, editingTarget);
        const conditionalCount =
          subjectKind === "checkbox_option"
            ? draft.targets.filter(
                (candidate) =>
                  candidate.kind === "conditional_share" &&
                  candidate.questionId === question.id &&
                  candidate.optionKey === option.key,
              ).length
            : 0;
        const summary = targetSummary(target, currentShare);

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => openOptionTarget(question, subjectKind, option.key, option.label)}
            className="group grid w-full grid-cols-[minmax(140px,1fr)_72px_72px_minmax(120px,1.2fr)_140px] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted/60"
          >
            <span className="truncate font-medium">{option.label}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {metric?.count ?? 0}명
            </span>
            <span className="text-right tabular-nums">{formatShare(currentShare)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-foreground/45"
                style={{ width: `${Math.max(0, Math.min(100, currentShare * 100))}%` }}
              />
            </span>
            <span
              className={`text-right tabular-nums ${
                summary || conditionalCount > 0
                  ? "font-medium"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100"
              }`}
            >
              {summary ?? (conditionalCount > 0 ? `그룹 목표 ${conditionalCount}` : "+ 목표")}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!loaded && !error) {
    return <p className="mt-4 text-sm text-muted-foreground">분포를 불러오는 중…</p>;
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border bg-background">
      <nav className="flex h-11 items-center gap-1 border-b px-3">
        <Button
          type="button"
          size="sm"
          variant={workspaceView === "setup" ? "secondary" : "ghost"}
          className="h-7"
          onClick={() => setWorkspaceView("setup")}
        >
          생성 설정
        </Button>
        <Button
          type="button"
          size="sm"
          variant={workspaceView === "result" ? "secondary" : "ghost"}
          className="h-7"
          disabled={runSummaries.length === 0 && runContexts.length === 0}
          onClick={() => {
            const runId = selectedRunId || runSummaries[0]?.runId || runContexts[0]?.run.runId;
            if (runId) void selectRun(runId);
          }}
        >
          결과
        </Button>
      </nav>

      {workspaceView === "result" ? (
        <ResultView
          contexts={runContexts}
          summaries={runSummaries}
          selectedRunId={selectedRunId}
          questions={questions}
          exportBusy={exportBusy}
          onSelectRun={(runId) => void selectRun(runId)}
          onEditTarget={(questionId) => {
            setSelectedQuestionId(questionId);
            setWorkspaceView("setup");
          }}
          onExport={(format) => void exportSelectedRun(format)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">증강 규칙</span>
            {ruleIds.map((ruleId, index) => (
              <Button
                key={ruleId}
                type="button"
                size="sm"
                variant={index === selectedRuleIndex ? "secondary" : "ghost"}
                className="h-7"
                onClick={() => selectRule(index)}
              >
                규칙 {index + 1}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={addRule}>
              규칙 추가
            </Button>
            {ruleIds.length > 1 ? (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={deleteRule}>
                현재 규칙 삭제
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              각 규칙은 독립된 기간·목표·시드를 사용합니다.
            </span>
          </div>
          <div className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">원본</span>
              <Select
                value={scopeEditor.kind}
                onValueChange={(next) => setSourceScopeKind(next as "all" | "submitted_between")}
              >
                <SelectTrigger className="h-8 w-[190px]">
                  <SelectValue>
                    {scopeEditor.kind === "all" ? `전체 응답 · ${sourceCount}명` : "응답 기간 선택"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 응답 · {sourceCount}명</SelectItem>
                  <SelectItem value="submitted_between">응답 기간 선택</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeEditor.kind === "submitted_between" ? (
              <div className="flex items-center gap-2 text-xs">
                <Input
                  type="datetime-local"
                  value={toDateTimeInput(scopeEditor.start)}
                  onChange={(event) => updateScopeDate("start", event.target.value)}
                  className="h-8 w-[190px]"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="datetime-local"
                  value={toDateTimeInput(scopeEditor.end)}
                  onChange={(event) => updateScopeDate("end", event.target.value)}
                  className="h-8 w-[190px]"
                />
              </div>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={scopeApplyBusy || !sourceScopeDirty || sourceScopeError !== null}
              onClick={() => void applySourceScope()}
            >
              {scopeApplyBusy ? "적용 중…" : "적용"}
            </Button>
            {sourceScopeError ? (
              <span className="text-xs text-destructive">{sourceScopeError}</span>
            ) : sourceScopeDirty ? (
              <span className="text-xs text-muted-foreground">
                적용하면 분포와 원본 응답 수가 갱신됩니다.
              </span>
            ) : null}
            <div className="flex items-center gap-2 text-sm">
              <Select
                value={ruleCounts[selectedRuleIndex]?.kind ?? "final"}
                onValueChange={(kind) => {
                  setRuleCounts((current) => {
                    const next = [...current];
                    const previous = next[selectedRuleIndex] ?? {
                      kind: "final" as const,
                      value: finalCount ?? sourceCount,
                    };
                    next[selectedRuleIndex] = {
                      kind: kind as "add" | "final",
                      value: previous.value,
                    };
                    return next;
                  });
                }}
              >
                <SelectTrigger className="h-8 w-[92px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">추가</SelectItem>
                  <SelectItem value="final">최종</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">응답</span>
              <Input
                inputMode="numeric"
                value={
                  ruleCounts[selectedRuleIndex]?.kind === "add"
                    ? (ruleCounts[selectedRuleIndex]?.value ?? "")
                    : (finalCount ?? "")
                }
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (ruleCounts[selectedRuleIndex]?.kind === "add") {
                    setRuleCounts((current) => {
                      const values = [...current];
                      values[selectedRuleIndex] = {
                        kind: "add",
                        value: Math.max(1, Math.trunc(next)),
                      };
                      return values;
                    });
                  } else
                    setDraft((current) => ({
                      ...current,
                      finalCount:
                        event.target.value === "" || !Number.isFinite(next)
                          ? null
                          : Math.trunc(next),
                    }));
                }}
                className="h-8 w-24 tabular-nums"
                aria-invalid={finalCountInvalid}
              />
              <span>명</span>
              {ruleCounts[selectedRuleIndex]?.kind === "add" ? (
                <span className="tabular-nums text-muted-foreground">
                  +{ruleCounts[selectedRuleIndex]?.value}명
                </span>
              ) : additions !== null ? (
                <span className="tabular-nums text-muted-foreground">+{additions}명</span>
              ) : null}
            </div>
            {sourceReviewCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-destructive"
                onClick={() => setSourceReviewOpen(true)}
              >
                확인 필요 {sourceReviewCount}
              </Button>
            ) : null}
            {profileBusy ? (
              <span className="text-xs text-muted-foreground">분포 갱신 중…</span>
            ) : null}
            {finalCountInvalid ? (
              <span className="text-xs text-destructive">
                최종 응답 수는 원본 응답 수보다 작을 수 없습니다.
              </span>
            ) : null}
          </div>

          <div className="grid min-h-[560px] grid-cols-[280px_minmax(0,1fr)]">
            <aside className="min-w-0 border-r">
              <div className="space-y-3 border-b p-3">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="문항 검색..."
                  aria-label="문항 검색"
                  className="h-8"
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={targetOnly ? "ghost" : "secondary"}
                    className="h-7 px-2"
                    onClick={() => setTargetOnly(false)}
                  >
                    모든 문항 {questions.length}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={targetOnly ? "secondary" : "ghost"}
                    className="h-7 px-2"
                    onClick={() => setTargetOnly(true)}
                  >
                    목표 {draft.targets.length}
                  </Button>
                </div>
              </div>
              <div className="max-h-[560px] overflow-y-auto p-2">
                {filteredQuestions.map((question) => {
                  const count = targetCountFor(question.id);
                  const needsReview = reviewQuestionIds.has(question.id);
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => setSelectedQuestionId(question.id)}
                      className={`flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/70 ${
                        question.id === selectedQuestion?.id ? "bg-muted font-medium" : ""
                      }`}
                    >
                      <span className="line-clamp-2 min-w-0">{question.title}</span>
                      {needsReview || count > 0 ? (
                        <span className="shrink-0 text-right text-xs font-normal">
                          {needsReview ? (
                            <span className="block text-destructive">확인 필요</span>
                          ) : null}
                          {count > 0 ? (
                            <span className="block text-muted-foreground">목표 {count}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-w-0 overflow-y-auto px-8 py-7">
              {selectedQuestion ? (
                <div className="max-w-[900px]">
                  <header>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {selectedQuestion.title}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {questionPopulationText(selectedQuestion, profile, sourceCount)}
                    </p>
                  </header>

                  {selectedQuestion.kind === "single_choice"
                    ? renderChoiceRows(selectedQuestion, "option")
                    : null}
                  {selectedQuestion.kind === "multi_choice"
                    ? renderChoiceRows(selectedQuestion, "checkbox_option")
                    : null}
                  {selectedQuestion.kind === "single_choice" &&
                  selectedLikertMapping &&
                  !selectedScoreMapping ? (
                    <div className="mt-7 flex max-w-md items-center justify-between gap-4 border-y py-4">
                      <div>
                        <p className="text-sm font-medium">점수형으로 해석</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          선택지 의미를 5점부터 1점까지로 해석합니다. 원본 응답은 바꾸지 않습니다.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            targets: [
                              ...current.targets.filter(
                                (target) =>
                                  !(
                                    target.kind === "mean" &&
                                    target.questionId === selectedQuestion.id
                                  ),
                              ),
                              {
                                id: meanTargetId(selectedQuestion.id),
                                kind: "mean",
                                questionId: selectedQuestion.id,
                                intent: null,
                                scoreMapping: selectedLikertMapping,
                              },
                            ],
                          }));
                          setEditingMean({
                            questionId: selectedQuestion.id,
                            questionTitle: selectedQuestion.title,
                            min: 1,
                            max: 5,
                          });
                          setMeanValue("");
                        }}
                      >
                        사용
                      </Button>
                    </div>
                  ) : null}
                  {selectedIsScoreQuestion && selectedQuestion ? (
                    <div className="mt-8 max-w-md">
                      <p className="text-xs font-medium text-muted-foreground">평균</p>
                      <div className="mt-2 flex items-end justify-between gap-4">
                        <div className="flex items-baseline gap-3">
                          <span className="text-3xl font-medium tabular-nums">
                            {meanMetric(profile, selectedQuestion.id)?.mean.toFixed(2) ?? "—"}
                          </span>
                          {meanTarget(draft.targets, selectedQuestion.id)?.intent ? (
                            <span className="text-sm font-medium tabular-nums">
                              →{" "}
                              {meanTarget(
                                draft.targets,
                                selectedQuestion.id,
                              )?.intent?.value.toFixed(2)}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openMeanTarget(selectedQuestion)}
                        >
                          목표 설정
                        </Button>
                      </div>
                      {selectedQuestion.min !== undefined || selectedScoreMapping ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          가능한 범위 {selectedQuestion.min ?? 1}–{selectedQuestion.max ?? 5}
                        </p>
                      ) : null}
                      <div className="mt-8 border-t pt-5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">점수별 분포</p>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            응답 {selectedOrdinalDistribution?.denominatorCount ?? 0}명
                          </span>
                        </div>
                        <div className="mt-3 space-y-1">
                          {selectedOrdinalDistribution?.values.map((item) => (
                            <div
                              key={item.value}
                              className="grid grid-cols-[48px_64px_64px_minmax(120px,1fr)] items-center gap-3 py-1.5 text-sm"
                            >
                              <span className="font-medium tabular-nums">{item.value}점</span>
                              <span className="text-right tabular-nums text-muted-foreground">
                                {item.count}명
                              </span>
                              <span className="text-right tabular-nums">
                                {formatShare(item.share)}
                              </span>
                              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-foreground/45"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, item.share * 100))}%`,
                                  }}
                                />
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {selectedQuestion.kind === "text" ? (
                    <TextInspector
                      question={selectedQuestion}
                      groups={groups}
                      values={textValues}
                      targets={draft.targets}
                      profile={profile}
                      busy={groupBusy}
                      invalidGroupIds={sourceReview?.invalidValueGroupIds ?? []}
                      onOpenTarget={openTarget}
                      onSaveGroup={saveGroup}
                      onDeleteGroup={requestDeleteGroup}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <footer className="flex min-h-14 items-center justify-between gap-4 border-t px-4 py-2">
            <p className="text-sm text-muted-foreground">
              원본 <span className="tabular-nums">{sourceCount}명</span>
              {additions !== null ? ` · +${additions}명 · 최종 ${finalCount}명` : ""}
              {` · ${draft.targets.length > 0 ? `목표 ${draft.targets.length}개` : "목표 없음"}`}
              {noAdditionalResponses ? " · 추가로 생성할 응답이 없습니다." : ""}
            </p>
            <Button
              type="button"
              disabled={busy || sourceScopeDirty || generationBlock !== null}
              onClick={() => void generateBatch()}
            >
              {busy ? "설정 확인 중…" : ruleIds.length > 1 ? "일괄 생성" : "생성"}
            </Button>
          </footer>
        </>
      )}

      {message ? (
        <p className="border-t px-4 py-2 text-sm text-muted-foreground">{message}</p>
      ) : null}
      {composite ? (
        <div className="border-t px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">복합 결과 · 최종 응답 {composite.finalResponseCount}명</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void exportComposite(composite.compositeId, "csv").catch((cause: unknown) =>
                    setError(questionExplorerErrorMessage(cause, "export_result")),
                  )
                }
              >
                CSV
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void exportComposite(composite.compositeId, "xlsx").catch((cause: unknown) =>
                    setError(questionExplorerErrorMessage(cause, "export_result")),
                  )
                }
              >
                XLSX
              </Button>
            </div>
          </div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {composite.children.map((child, index) => (
              <p key={child.ruleId}>
                규칙 {index + 1} · 원본 {child.scopeResponseCount}명 ·{" "}
                {child.count.kind === "add"
                  ? `+${child.count.value}명`
                  : `최종 ${child.count.value}명`}{" "}
                · 결과 {child.finalResponseCount}명
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{editing?.label ?? "목표"}</SheetTitle>
            <SheetDescription>
              {editing?.questionTitle ?? "문항"}
              {activeMetric
                ? ` · 현재 ${activeMetric.count}/${activeMetric.denominatorCount}명 · ${formatShare(
                    activeMetric.share,
                  )}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 py-5">
            {editing?.subjectKind === "checkbox_option" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">기준</label>
                <Select
                  value={populationGroupId}
                  onValueChange={(value) => value && changePopulation(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {populationGroupId === "all"
                        ? "전체 응답 대상"
                        : `특정 그룹 · ${groups.find((group) => group.id === populationGroupId)?.name ?? "그룹"}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 응답 대상</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        특정 그룹 · {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {conditionalMode && !currentConditionalMetric ? (
                  <p className="text-xs text-muted-foreground">
                    현재 선택 범위에는 비율을 계산할 응답 대상이 없습니다.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium">목표</label>
              <Select
                value={mode}
                onValueChange={(nextMode) => {
                  setMode(nextMode as TargetMode);
                  setValue("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(
                      {
                        absolute_share: "최종 비율",
                        percentage_point_delta: "현재보다 %p 변경",
                        relative_percent_delta: "현재 비율에서 % 변경",
                        absolute_count: "최종 인원수",
                        count_delta: "현재보다 인원수 변경",
                      } as Record<string, string>
                    )[mode] ?? "목표 선택"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="absolute_share">최종 비율</SelectItem>
                  <SelectItem value="percentage_point_delta">현재보다 %p 변경</SelectItem>
                  <SelectItem value="relative_percent_delta">현재 비율에서 % 변경</SelectItem>
                  {!conditionalMode ? (
                    <>
                      <SelectItem value="absolute_count">최종 인원수</SelectItem>
                      <SelectItem value="count_delta">현재보다 인원수 변경</SelectItem>
                    </>
                  ) : null}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  inputMode={shareMode ? "decimal" : "numeric"}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-invalid={value !== "" && valueInvalid}
                  className="tabular-nums"
                  placeholder={shareMode ? "예: 50" : "예: 125"}
                />
                <span className="w-8 text-sm">
                  {shareMode ? (mode === "percentage_point_delta" ? "%p" : "%") : "명"}
                </span>
              </div>
              {value !== "" && valueInvalid ? (
                <p className="text-xs text-destructive">유효한 목표 값을 입력해주세요.</p>
              ) : null}
            </div>
            {activeMetric && value !== "" && !valueInvalid ? (
              <div className="space-y-1 text-sm">
                {shareMode ? (
                  <>
                    <p className="font-medium tabular-nums">
                      현재 {formatShare(activeMetric.share)}
                    </p>
                    {resolvedShare !== null ? (
                      <p className="tabular-nums text-muted-foreground">
                        → 목표 {formatShare(resolvedShare)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="font-medium tabular-nums">현재 {activeMetric.count}명</p>
                    {resolvedCount !== null ? (
                      <p className="tabular-nums text-muted-foreground">→ 목표 {resolvedCount}명</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          <SheetFooter className="flex-row items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={!currentTarget}
              onClick={removeTarget}
            >
              목표 삭제
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                취소
              </Button>
              <Button type="button" disabled={valueInvalid} onClick={commitTarget}>
                목표 설정
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={editingMean !== null} onOpenChange={(open) => !open && setEditingMean(null)}>
        <SheetContent className="sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle>{editingMean?.questionTitle ?? "평균 목표"}</SheetTitle>
            <SheetDescription>
              현재 평균 {currentMeanMetric?.mean.toFixed(2) ?? "—"}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">목표 평균</label>
              <Input
                autoFocus
                inputMode="decimal"
                value={meanValue}
                onChange={(event) => setMeanValue(event.target.value)}
                aria-invalid={meanValue !== "" && meanValueInvalid}
                className="tabular-nums"
                placeholder={editingMean ? `${editingMean.min}–${editingMean.max}` : ""}
              />
              {editingMean ? (
                <p className="text-xs text-muted-foreground">
                  가능한 범위 {editingMean.min}–{editingMean.max}
                </p>
              ) : null}
            </div>
          </div>
          <SheetFooter className="flex-row items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={!currentMeanTarget}
              onClick={removeMeanTarget}
            >
              목표 삭제
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingMean(null)}>
                취소
              </Button>
              <Button type="button" disabled={meanValueInvalid} onClick={commitMeanTarget}>
                목표 설정
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={sourceReviewOpen} onOpenChange={setSourceReviewOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>원본 업데이트 후 확인이 필요합니다</DialogTitle>
            <DialogDescription>
              저장된 그룹과 목표를 자동으로 바꾸지 않았습니다. 필요한 항목만 직접 확인하거나
              제거하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {activeReviewGroups.map((group) => {
              const question = questions.find((candidate) => candidate.id === group.questionId);
              const dependencyCount = dependentTargets(draft.targets, group.id).length;
              return (
                <div key={group.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">그룹 · {group.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {question?.title ?? "원본에서 사라진 문항"}
                    </p>
                    {dependencyCount > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        연결 목표 {dependencyCount}개
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {question ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedQuestionId(question.id);
                          setWorkspaceView("setup");
                          setSourceReviewOpen(false);
                        }}
                      >
                        문항으로 이동
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={groupBusy}
                      onClick={() => void repairReviewGroup(group)}
                    >
                      {dependencyCount > 0
                        ? `목표 ${dependencyCount}개 제거 후 그룹 삭제`
                        : "그룹 삭제"}
                    </Button>
                  </div>
                </div>
              );
            })}
            {activeReviewTargetIssues.map((issue, index) => {
              const target = issue.targetIds
                .map((issueTargetId) =>
                  draft.targets.find((candidate) => String(candidate.id) === String(issueTargetId)),
                )
                .find((candidate) => candidate !== undefined);
              const questionId = target ? questionIdForTarget(target, groups) : null;
              const question = questionId
                ? questions.find((candidate) => candidate.id === questionId)
                : undefined;
              return (
                <div
                  key={`${issue.code}-${index}`}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">목표 설정</p>
                    <p className="mt-1 text-xs text-muted-foreground">{issueMessage(issue)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {question ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedQuestionId(question.id);
                          setWorkspaceView("setup");
                          setSourceReviewOpen(false);
                        }}
                      >
                        문항으로 이동
                      </Button>
                    ) : null}
                    {issue.targetIds.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => removeReviewTargets(issue)}
                      >
                        목표 제거
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSourceReviewOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteBlockedGroup !== null}
        onOpenChange={(open) => !open && setDeleteBlockedGroup(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>이 그룹을 사용하는 목표가 있습니다</DialogTitle>
            <DialogDescription>
              그룹을 바로 삭제하지 않습니다. 먼저 연결된 목표를 확인하거나 수정하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            {deleteBlockedGroup
              ? dependentTargets(draft.targets, deleteBlockedGroup.id).map((target) => (
                  <p key={String(target.id)}>{targetLabel(target, questions, groups)}</p>
                ))
              : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteBlockedGroup(null)}>
              닫기
            </Button>
            <Button type="button" onClick={navigateToGroupDependency}>
              연결된 목표 보기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issues.length > 0} onOpenChange={(open) => !open && setIssues([])}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>생성 전에 확인할 설정이 있습니다</DialogTitle>
            <DialogDescription>
              문제가 있는 목표를 수정한 뒤 다시 생성하면 됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {issues.map((issue, index) => (
              <div
                key={`${issue.code}-${index}`}
                className="flex items-start justify-between gap-4 py-3"
              >
                <p className="text-sm">{issueMessage(issue)}</p>
                {issue.targetIds.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => navigateToIssue(issue)}
                  >
                    문항으로 이동
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssues([])}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editPlan !== null} onOpenChange={(open) => !open && setEditPlan(null)}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>원본 응답을 유지할지 선택하세요</DialogTitle>
            <DialogDescription>
              원본을 그대로 유지하면 목표와 차이가 남을 수 있습니다. 대체를 선택해도 Google Forms의
              원본 응답은 변경되지 않습니다.
            </DialogDescription>
          </DialogHeader>
          {editPlan ? (
            <div className="space-y-4 py-2">
              <p className="text-sm">
                대체를 선택하면 원본 응답 {editPlan.preview.replacementCount}개를 생성 결과 안에서
                다른 응답으로 바꿉니다.
              </p>
              <div className="divide-y border-y">
                {editPlan.preview.appendOnlyOutcome.targets.map((appendOutcome) => {
                  const replacementOutcome = editPlan.preview.replacementOutcome.targets.find(
                    (candidate) => candidate.targetId === appendOutcome.targetId,
                  );
                  const target = draft.targets.find(
                    (candidate) => String(candidate.id) === String(appendOutcome.targetId),
                  );
                  return (
                    <div key={String(appendOutcome.targetId)} className="py-3 text-sm">
                      <p className="font-medium">
                        {target ? targetLabel(target, questions, groups) : "목표"}
                      </p>
                      <p className="mt-1 tabular-nums text-muted-foreground">
                        원본 유지 {editPlanOutcomeValue(appendOutcome)} · 대체{" "}
                        {editPlanOutcomeValue(replacementOutcome)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void resolveEditPlan("append_only")}
            >
              원본 유지
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void resolveEditPlan("replacement")}
            >
              원본 {editPlan?.preview.replacementCount ?? 0}개 대체
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={compositeEditPlan !== null}
        onOpenChange={(open) => !open && setCompositeEditPlan(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>규칙의 원본 대체 선택</DialogTitle>
            <DialogDescription>
              {compositeEditPlan
                ? `${compositeEditPlan.ruleId} 규칙에 원본 대체 승인이 필요합니다.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            대체 대상 원본 응답 {compositeEditPlan?.preview.replacementCount ?? 0}개
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void resolveCompositePlan("append_only")}
            >
              원본 유지
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void resolveCompositePlan("replacement")}
            >
              원본 대체
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
