import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

import type { FormId, FormListItem, GoogleAccountId, SessionView } from "@survey-synth/contracts";
import type { FormSnapshot, ProjectTargets } from "@survey-synth/domain";

import {
  BackendClientError,
  addAccount,
  cancelFormImport,
  getSession,
  importForm,
  deleteAccountData,
  deleteProject,
  login,
  listProjects,
  logout,
  revokeAccess,
  switchAccount,
  cancelSynthesis,
  startSynthesis,
  getRun,
  exportRun,
  refreshSource,
  cancelRefreshSource,
  resolveMigrationIssue,
  getAiStatus,
  configureAi,
  clearAiCredentials,
  acknowledgeAiDisclosure,
  generateAiText,
  cancelAiGeneration,
  getProjectTimeline,
} from "./api/backend";
import { checkOnceDaily } from "./updater";
import { AuthLoadingScreen, AuthLoginScreen } from "./components/auth-screen";
import { ProjectSwitcher } from "./components/project-switcher";
import { WorkspaceNav } from "./components/workspace-nav";
import { SurveyTree } from "./components/survey-tree";
import { AccountNavUser } from "./components/account-nav-user";
import { WorkspaceScreen } from "./components/workspace-screen";
import { type RunDetailView } from "./components/synthesis-results";
import { WorkspaceResultsScreen } from "./components/workspace-results-screen";
import { NewProjectDialog } from "./components/new-project-dialog";
import { ApiKeyDialog, AiDisclosureDialog } from "./components/ai-dialogs";
import {
  ConfirmDeleteProjectDialog,
  ConfirmDeleteAccountDataDialog,
  ConfirmRevokeDialog,
  ConfirmAiClearDialog,
} from "./components/confirm-dialogs";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceRoute } from "./hooks/use-workspace-route";
import { useWorkspaceQueries } from "./hooks/use-workspace-queries";
import { useTargetDraft } from "./hooks/use-target-draft";
import { projectsQueryKey, sessionQueryKey } from "./lib/query-keys";

export {
  accountsQueryKey,
  formsQueryKey,
  projectsQueryKey,
  sessionQueryKey,
} from "./lib/query-keys";

export const errorMessage = (error: unknown): string => {
  if (error instanceof BackendClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류가 발생했습니다";
};

export const mergeForms = (
  pages: readonly { readonly items: readonly FormListItem[] }[],
): readonly FormListItem[] => {
  const merged = new Map<string, FormListItem>();
  for (const page of pages) {
    for (const item of page.items) {
      if (!merged.has(item.formId)) merged.set(item.formId, item);
    }
  }
  return [...merged.values()];
};

export const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

export function App() {
  const queryClient = useQueryClient();
  const { route, navigate } = useWorkspaceRoute();
  const [formQuery, setFormQuery] = useState("");
  const selectedProjectId = route.projectId;
  const workspaceView = route.view;
  const selectedSurveyQuestionId = route.questionId;
  const [completedRun, setCompletedRun] = useState<{
    runId: string;
    count: number;
    syntheticCount: number;
  } | null>(null);
  const [timestampRange, setTimestampRange] = useState<{ start: string; end: string } | undefined>();
  const debouncedFormQuery = useDebouncedValue(formQuery, 250);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<GoogleAccountId | null>(
    null,
  );
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [confirmAiCredentialClear, setConfirmAiCredentialClear] = useState(false);
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | undefined>(undefined);
  const transitionLock = useRef(false);

  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => getSession(),
    retry: false,
  });
  const session = sessionQuery.data;
  const activeAccountId = session?.account.id ?? null;
  const { projectsQuery, projectQuery, targetsQuery, accountsQuery, formsQuery } =
    useWorkspaceQueries({
      activeAccountId,
      selectedProjectId,
      formQuery: debouncedFormQuery,
    });
  // A run belongs to the route, not to the previous in-memory completion state.
  // This prevents back/forward navigation or a direct URL from briefly showing
  // another project's result query.
  const activeRunId = workspaceView === "results" ? route.runId : null;
  const completedRunForRoute =
    completedRun !== null && completedRun.runId === activeRunId ? completedRun : null;
  const runQuery = useQuery({
    queryKey: ["runs.get", activeRunId],
    queryFn: () => getRun(activeRunId ?? ""),
    enabled: activeRunId !== null,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: () => login(),
    onSuccess: (nextSession: SessionView) => {
      queryClient.setQueryData(sessionQueryKey, nextSession);
      void queryClient.invalidateQueries({ queryKey: ["auth.accounts"] });
    },
  });
  const addAccountMutation = useMutation({
    mutationFn: () => addAccount(),
    onSuccess: (nextSession: SessionView) => {
      queryClient.setQueryData(sessionQueryKey, nextSession);
      void queryClient.invalidateQueries({ queryKey: ["auth.accounts"] });
    },
  });
  const switchAccountMutation = useMutation({
    mutationFn: (id: GoogleAccountId) => switchAccount(id),
    onSuccess: (nextSession: SessionView) => {
      queryClient.setQueryData(sessionQueryKey, nextSession);
      void queryClient.invalidateQueries({ queryKey: ["auth.accounts"] });
    },
  });
  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.removeQueries({ queryKey: ["auth.accounts"] });
      queryClient.removeQueries({ queryKey: ["forms.list"] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (id: GoogleAccountId) => revokeAccess(id),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.removeQueries({ queryKey: ["auth.accounts"] });
      queryClient.removeQueries({ queryKey: ["forms.list"] });
    },
  });
  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => {
      setConfirmDeleteProject(false);
      navigate({ projectId: null, view: "home", questionId: null, runId: null });
      setCompletedRun(null);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
  const deleteAccountDataMutation = useMutation({
    mutationFn: (id: GoogleAccountId) => deleteAccountData(id),
    onSuccess: async () => {
      setConfirmDeleteAccountId(null);
      navigate({ projectId: null, view: "home", questionId: null, runId: null });
      setCompletedRun(null);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["auth.accounts"] });
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
  });
  const importMutation = useMutation({
    mutationFn: ({ formId, operationId }: { formId: FormId; operationId: string }) =>
      importForm(formId, operationId),
    onSuccess: async (result) => {
      const projects = await queryClient.fetchQuery({
        queryKey: projectsQueryKey,
        queryFn: () => listProjects(),
      });
      const project = projects.find(
        (item) =>
          item.googleFormId === result.formId &&
          (activeAccountId === null || item.googleAccountId === activeAccountId),
      );
      if (project !== undefined)
        navigate({ projectId: project.id, view: "home", questionId: null, runId: null });
      setNewProjectDialogOpen(false);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (operationId: string) => cancelFormImport(operationId),
  });
  const synthesisMutation = useMutation({
    mutationFn: ({
      projectId,
      targets,
      operationId,
    }: {
      projectId: string;
      targets: ProjectTargets;
      operationId: string;
    }) =>
      startSynthesis(
        projectId,
        targets,
        1,
        operationId,
        undefined,
        targetRevision.current,
        timestampRange,
      ),
    onSuccess: (result) => {
      if (result.status !== "success" || selectedProjectId === null) return;
      setCompletedRun({
        runId: result.runId,
        count: result.finalResponseCount,
        syntheticCount: result.syntheticResponseCount,
      });
      navigate({
        projectId: selectedProjectId,
        view: "results",
        questionId: null,
        runId: result.runId,
      });
    },
  });

  useEffect(() => {
    const range = projectQuery.data?.responseTimestampRange;
    setTimestampRange(range === null || range === undefined ? undefined : range);
  }, [projectQuery.data?.id, projectQuery.data?.responseTimestampRange]);
  const rangeCountQuery = useQuery({
    queryKey: ["projects.timeline.count", selectedProjectId, timestampRange?.start, timestampRange?.end],
    queryFn: () =>
      getProjectTimeline(
        selectedProjectId!,
        timestampRange!.start,
        timestampRange!.end,
        240,
        0,
        1,
      ),
    enabled: selectedProjectId !== null && timestampRange !== undefined,
    staleTime: 60_000,
    retry: false,
    placeholderData: (previous) => previous,
  });
  const {
    draftTargets,
    targetRevision,
    saveSequence,
    targetUpdateMutation,
    feasibilityMutation,
    flushTargets,
    handleDraftChange: handleTargetDraftChange,
  } = useTargetDraft({
    projectId: selectedProjectId,
    serverRevision: targetsQuery.data?.revision,
    serverTargets: targetsQuery.data?.targets as unknown as ProjectTargets | undefined,
  });
  const cancelSynthesisMutation = useMutation({
    mutationFn: (operationId: string) => cancelSynthesis(operationId),
  });

  const [refreshOperationId, setRefreshOperationId] = useState<string | undefined>(undefined);
  const [refreshStatusMessage, setRefreshStatusMessage] = useState<string | undefined>(undefined);

  const refreshMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await flushTargets();
      const opId = crypto.randomUUID();
      setRefreshOperationId(opId);
      return refreshSource(projectId, targetRevision.current, opId);
    },
    onSuccess: (result) => {
      setRefreshOperationId(undefined);
      if (result.status === "no_change") {
        setRefreshStatusMessage("새로운 응답 또는 변경사항이 없습니다.");
      } else {
        targetRevision.current = result.targetRevision;
        setRefreshStatusMessage(
          `최신 응답을 반영했습니다 (추가 ${result.addedResponseCount}건, 변경 ${result.changedResponseCount}건, 삭제 ${result.removedResponseCount}건).`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      if (selectedProjectId) {
        void queryClient.invalidateQueries({ queryKey: ["projects.get", selectedProjectId] });
        void queryClient.invalidateQueries({ queryKey: ["targets.get", selectedProjectId] });
      }
    },
    onError: (error) => {
      setRefreshOperationId(undefined);
      if (error instanceof BackendClientError && error.backendError.code === "JOB_CANCELLED") {
        setRefreshStatusMessage("가져오기를 취소했습니다.");
      }
    },
  });

  const cancelRefreshMutation = useMutation({
    mutationFn: (operationId: string) => cancelRefreshSource(operationId),
  });

  const resolveIssueMutation = useMutation({
    mutationFn: ({
      projectId,
      issueId,
      resolution,
    }: {
      projectId: string;
      issueId: string;
      resolution?: "acknowledge" | "remove_target";
    }) => resolveMigrationIssue(projectId, issueId, resolution),
    onSuccess: () => {
      if (selectedProjectId) {
        void queryClient.invalidateQueries({ queryKey: ["projects.get", selectedProjectId] });
        void queryClient.invalidateQueries({ queryKey: ["targets.get", selectedProjectId] });
      }
    },
  });

  const [exportFeedback, setExportFeedback] = useState<string | undefined>(undefined);
  const exportMutation = useMutation({
    mutationFn: ({ runId, format }: { runId: string; format: "csv" | "xlsx" }) =>
      exportRun(runId, format),
    onSuccess: (result) => {
      if (!result.cancelled && result.destination) {
        setExportFeedback(`저장 완료: ${result.destination}`);
      }
    },
  });

  const handleExport = (format: "csv" | "xlsx") => {
    if (activeRunId === null) return;
    setExportFeedback(undefined);
    exportMutation.mutate({ runId: activeRunId, format });
  };

  const aiStatusQuery = useQuery({
    queryKey: ["ai.status"],
    queryFn: () => getAiStatus(),
  });

  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showDisclosureDialog, setShowDisclosureDialog] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | undefined>(undefined);
  const [aiOperationId, setAiOperationId] = useState<string | undefined>(undefined);

  const startAiGeneration = () => {
    if (activeRunId === null) return;
    const opId = crypto.randomUUID();
    setAiOperationId(opId);
    setAiFeedback(undefined);
    aiGenerateMutation.mutate({ runId: activeRunId, operationId: opId });
  };

  const aiConfigureMutation = useMutation({
    mutationFn: (apiKey: string) => configureAi(apiKey),
    onSuccess: () => {
      setShowApiKeyDialog(false);
      void queryClient.invalidateQueries({ queryKey: ["ai.status"] });
      if (!aiStatusQuery.data?.disclosed) {
        setShowDisclosureDialog(true);
      } else if (activeRunId !== null) {
        startAiGeneration();
      }
    },
  });

  const aiClearCredentialsMutation = useMutation({
    mutationFn: () => clearAiCredentials(),
    onSuccess: () => {
      setConfirmAiCredentialClear(false);
      void queryClient.invalidateQueries({ queryKey: ["ai.status"] });
    },
  });

  const aiDisclosureMutation = useMutation({
    mutationFn: () => acknowledgeAiDisclosure(),
    onSuccess: () => {
      setShowDisclosureDialog(false);
      void queryClient.invalidateQueries({ queryKey: ["ai.status"] });
      if (activeRunId !== null) {
        startAiGeneration();
      }
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: ({ runId, operationId }: { runId: string; operationId?: string }) =>
      generateAiText(runId, operationId),
    onSuccess: (result) => {
      setAiOperationId(undefined);
      if (result.status === "skipped") {
        setAiFeedback("AI 적용 가능한 텍스트 항목이 없습니다.");
      } else {
        setAiFeedback(`AI 텍스트 채움 완료 (${result.generatedFieldCount}개 항목).`);
      }
      if (activeRunId !== null) {
        void queryClient.invalidateQueries({ queryKey: ["runs.get", activeRunId] });
      }
    },
    onError: () => {
      setAiOperationId(undefined);
    },
  });

  const aiCancelMutation = useMutation({
    mutationFn: (operationId: string) => cancelAiGeneration(operationId),
  });

  const handleStartAi = () => {
    if (!aiStatusQuery.data?.configured) {
      setShowApiKeyDialog(true);
      return;
    }
    if (!aiStatusQuery.data?.disclosed) {
      setShowDisclosureDialog(true);
      return;
    }
    startAiGeneration();
  };

  const handleCancelAi = () => {
    if (aiOperationId) {
      aiCancelMutation.mutate(aiOperationId);
    }
  };

  const importOperationId = importMutation.variables?.operationId;
  const synthesisOperationId = synthesisMutation.variables?.operationId;
  const authBusy =
    loginMutation.isPending ||
    addAccountMutation.isPending ||
    switchAccountMutation.isPending ||
    logoutMutation.isPending ||
    revokeMutation.isPending ||
    deleteAccountDataMutation.isPending;
  const importBusy = importMutation.isPending || cancelMutation.isPending;
  const refreshBusy = refreshMutation.isPending || cancelRefreshMutation.isPending;
  const updateBlocked =
    importBusy ||
    refreshBusy ||
    synthesisMutation.isPending ||
    exportMutation.isPending ||
    aiGenerateMutation.isPending ||
    deleteProjectMutation.isPending ||
    deleteAccountDataMutation.isPending;
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const updateInstallMutation = useMutation({
    mutationFn: async () => {
      if (availableUpdate === null || updateBlocked) return;
      await availableUpdate.download();
      await flushTargets();
      if (updateBlocked) return;
      await invoke("checkpoint_for_update");
      await availableUpdate.install();
      await invoke("restart_after_update");
    },
  });
  const busy =
    authBusy ||
    importBusy ||
    refreshBusy ||
    deleteProjectMutation.isPending ||
    updateInstallMutation.isPending ||
    transitionPending;
  const forms = mergeForms(formsQuery.data?.pages ?? []);
  const formsLoading = formsQuery.isPending || formsQuery.isFetchingNextPage;
  const sessionError = sessionQuery.error;
  const actionError =
    loginMutation.error ??
    addAccountMutation.error ??
    switchAccountMutation.error ??
    logoutMutation.error ??
    revokeMutation.error;
  const importError =
    importMutation.error instanceof BackendClientError &&
    importMutation.error.backendError.code === "JOB_CANCELLED"
      ? undefined
      : importMutation.error;

  useEffect(() => {
    void checkOnceDaily(check, window.localStorage)
      .then(setAvailableUpdate)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    importMutation.reset();
    cancelMutation.reset();
  }, [activeAccountId]);

  useEffect(() => {
    const form = projectQuery.data?.form as FormSnapshot | undefined;
    if (form === undefined || workspaceView !== "survey") return;
    if (form.questions.some((question) => String(question.id) === selectedSurveyQuestionId)) return;
    const questionId = String(form.questions[0]?.id ?? "") || null;
    navigate({ projectId: selectedProjectId, view: "survey", questionId, runId: null });
  }, [navigate, projectQuery.data, selectedProjectId, selectedSurveyQuestionId, workspaceView]);

  const handleLogin = (): void => {
    loginMutation.mutate();
  };

  const withFlushedTargets = (action: () => void): void => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    setTransitionPending(true);
    setTransitionError(undefined);
    void flushTargets()
      .then(action)
      .catch((error: unknown) => setTransitionError(errorMessage(error)))
      .finally(() => {
        transitionLock.current = false;
        setTransitionPending(false);
      });
  };

  const handleAddAccount = (): void => {
    withFlushedTargets(() => addAccountMutation.mutate());
  };

  const handleSwitchAccount = (id: GoogleAccountId): void => {
    withFlushedTargets(() => switchAccountMutation.mutate(id));
  };

  const handleLogout = (): void => {
    withFlushedTargets(() => logoutMutation.mutate());
  };

  const handleRevoke = (): void => {
    if (activeAccountId === null) return;
    withFlushedTargets(() => revokeMutation.mutate(activeAccountId));
  };

  const handleImport = (formId: FormId): void => {
    importMutation.mutate({ formId, operationId: crypto.randomUUID() });
  };

  const handleCancelImport = (): void => {
    if (importOperationId === undefined) return;
    cancelMutation.mutate(importOperationId);
  };

  const handleProjectSelect = (projectId: string): void => {
    if (projectId === selectedProjectId) return;
    setConfirmDeleteProject(false);
    withFlushedTargets(() => {
      setCompletedRun(null);
      navigate({ projectId, view: "home", questionId: null, runId: null });
    });
  };

  const handleGenerate = (): void => {
    if (selectedProjectId === null) return;
    const projectId = selectedProjectId;
    const targets = draftTargets as ProjectTargets;
    if (!Number.isInteger(targets.targetResponseCount) || targets.targetResponseCount < 0) return;
    saveSequence.current += 1;
    targetUpdateMutation.mutate(
      {
        projectId,
        revision: targetRevision.current,
        targets,
        sequence: saveSequence.current,
      },
      {
        onSuccess: (result) =>
          synthesisMutation.mutate({
            projectId,
            targets: result.targets as unknown as ProjectTargets,
            operationId: crypto.randomUUID(),
          }),
      },
    );
  };

  const handleCancelSynthesis = (): void => {
    if (synthesisOperationId !== undefined) cancelSynthesisMutation.mutate(synthesisOperationId);
  };

  const handleRefreshSource = (): void => {
    if (selectedProjectId === null) return;
    const currentDraft = draftTargets as ProjectTargets;
    if (
      !Number.isInteger(currentDraft.targetResponseCount) ||
      currentDraft.targetResponseCount < 0
    ) {
      setRefreshStatusMessage("목표 설정에 오류가 있어 최신 응답을 가져올 수 없습니다.");
      return;
    }
    setRefreshStatusMessage(undefined);
    refreshMutation.mutate(selectedProjectId);
  };

  const handleCancelRefresh = (): void => {
    if (refreshOperationId !== undefined) cancelRefreshMutation.mutate(refreshOperationId);
  };

  const handleInstallUpdate = (): void => {
    if (availableUpdate === null || updateBlocked) return;
    updateInstallMutation.mutate();
  };

  const handleResolveIssue = (
    issueId: string,
    resolution: "acknowledge" | "remove_target",
  ): void => {
    if (selectedProjectId === null) return;
    resolveIssueMutation.mutate({ projectId: selectedProjectId, issueId, resolution });
  };

  if (sessionQuery.isPending) {
    return <AuthLoadingScreen />;
  }

  if (session === null || session === undefined) {
    return (
      <AuthLoginScreen
        onLogin={handleLogin}
        loginPending={loginMutation.isPending}
        busy={busy}
        error={
          (sessionError ?? actionError) !== null && (sessionError ?? actionError) !== undefined
            ? errorMessage(sessionError ?? actionError)
            : undefined
        }
      />
    );
  }

  const accounts = accountsQuery.data ?? [session.account];
  const formsError = formsQuery.error;
  const importStatus =
    importMutation.isSuccess && importMutation.data !== undefined
      ? `${importMutation.data.title} 가져오기 완료`
      : importMutation.error instanceof BackendClientError &&
          importMutation.error.backendError.code === "JOB_CANCELLED"
        ? "가져오기를 취소했습니다"
        : undefined;

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <ProjectSwitcher
              projects={projectsQuery.data ?? []}
              selectedProjectId={selectedProjectId}
              onProjectSelect={handleProjectSelect}
              onNewProject={() => setNewProjectDialogOpen(true)}
              onRefresh={handleRefreshSource}
              onDelete={() => setConfirmDeleteProject(true)}
              refreshDisabled={
                busy ||
                refreshMutation.isPending ||
                (projectQuery.data?.migrationIssues ?? targetsQuery.data?.issues ?? []).some(
                  (issue) => issue.severity === "blocking",
                )
              }
              deleteDisabled={busy || refreshMutation.isPending}
            />
            <WorkspaceNav
              view={workspaceView}
              onChange={(view) => {
                if (selectedProjectId === null) return;
                const form = projectQuery.data?.form as FormSnapshot | undefined;
                const questionId =
                  view === "survey"
                    ? (selectedSurveyQuestionId ?? (String(form?.questions[0]?.id ?? "") || null))
                    : null;
                if (view === "survey" && questionId === null) return;
                if (view === "results" && route.runId === null) return;
                navigate({
                  projectId: selectedProjectId,
                  view,
                  questionId,
                  runId: view === "results" ? route.runId : null,
                });
              }}
            />
          </SidebarHeader>
          <SidebarSeparator />
          <SidebarContent>
            <SurveyTree
              form={(projectQuery.data?.form as FormSnapshot | undefined) ?? null}
              selectedQuestionId={selectedSurveyQuestionId}
              onQuestionSelect={(questionId) => {
                navigate({
                  projectId: selectedProjectId,
                  view: "survey",
                  questionId,
                  runId: null,
                });
              }}
            />
          </SidebarContent>
          <SidebarFooter>
            <AccountNavUser
              session={session}
              accounts={accounts}
              busy={busy || deleteAccountDataMutation.isPending || aiGenerateMutation.isPending}
              onSwitchAccount={handleSwitchAccount}
              onAddAccount={handleAddAccount}
              onLogout={handleLogout}
              onRevoke={() => setConfirmRevoke(true)}
              onClearAiCredentials={() => setConfirmAiCredentialClear(true)}
              showAiClear={aiStatusQuery.data?.configured ?? false}
              onDeleteData={setConfirmDeleteAccountId}
            />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="workspace-toolbar">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <div className="workspace-toolbar-copy">
              <h1 className="workspace-title">{projectQuery.data?.name ?? "프로젝트"}</h1>
            </div>
          </header>
          <div className="workspace-content">
            {availableUpdate !== null && (
              <Alert>
                <AlertTitle>새 버전 {availableUpdate.version}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  {updateBlocked && "진행 중인 작업이 끝나면 설치할 수 있습니다."}
                  {updateInstallMutation.error && "업데이트를 설치할 수 없습니다."}
                </AlertDescription>
                <Button
                  size="sm"
                  className="mt-2 w-fit"
                  onClick={handleInstallUpdate}
                  disabled={updateBlocked || updateInstallMutation.isPending}
                >
                  업데이트
                </Button>
              </Alert>
            )}
            {(accountsQuery.error ?? actionError) !== null &&
              (accountsQuery.error ?? actionError) !== undefined && (
                <FieldError>{errorMessage(accountsQuery.error ?? actionError)}</FieldError>
              )}
            {transitionError !== undefined && <FieldError>{transitionError}</FieldError>}
            {projectsQuery.error !== null && projectsQuery.error !== undefined && (
              <FieldError>{errorMessage(projectsQuery.error)}</FieldError>
            )}

            <NewProjectDialog
              open={newProjectDialogOpen}
              onOpenChange={setNewProjectDialogOpen}
              formQuery={formQuery}
              onFormQueryChange={setFormQuery}
              forms={forms}
              formsLoading={formsLoading}
              formsError={formsError ? errorMessage(formsError) : undefined}
              importBusy={importBusy}
              importError={importError ? errorMessage(importError) : undefined}
              cancelError={cancelMutation.error ? errorMessage(cancelMutation.error) : undefined}
              cancelPending={cancelMutation.isPending}
              hasNextPage={Boolean(formsQuery.hasNextPage)}
              isFetchingNextPage={formsQuery.isFetchingNextPage}
              onFetchNextPage={() => void formsQuery.fetchNextPage()}
              importStatus={importStatus}
              onImport={handleImport}
              onCancelImport={handleCancelImport}
              busy={busy}
            />

            <section
              className="workspace-projects"
              data-selected={selectedProjectId !== null}
              aria-label="선택한 프로젝트"
            >
              {selectedProjectId !== null &&
                projectQuery.isPending &&
                projectQuery.data === undefined && (
                  <div className="workspace-loading" role="status" aria-live="polite">
                    <span className="sr-only">프로젝트 불러오는 중…</span>
                    <Skeleton className="h-8 w-2/5" />
                    <Skeleton className="h-32 w-full" />
                    <div className="flex w-full flex-col gap-3">
                      <Skeleton className="h-5 w-4/5" />
                      <Skeleton className="h-5 w-3/5" />
                    </div>
                  </div>
                )}
              {projectQuery.data !== undefined &&
                projectQuery.data !== null &&
                (() => {
                  const project = projectQuery.data;
                  const migrationIssues =
                    project.migrationIssues ?? targetsQuery.data?.issues ?? [];
                  const hasBlockingIssues = migrationIssues.some(
                    (issue) => issue.severity === "blocking",
                  );

                  return (
                    <div aria-live="polite">
                      {refreshMutation.isPending && (
                        <div
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                          role="status"
                        >
                          <Spinner aria-hidden="true" />
                          <span>설문지 구조 및 응답을 가져오는 중…</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelRefresh}
                            disabled={cancelRefreshMutation.isPending}
                          >
                            가져오기 취소
                          </Button>
                        </div>
                      )}
                      {refreshStatusMessage && (
                        <p role="status" className="text-sm text-muted-foreground">
                          {refreshStatusMessage}
                        </p>
                      )}
                      {migrationIssues.length > 0 && (
                        <Alert variant="destructive">
                          <AlertTitle>목표 확인이 필요합니다</AlertTitle>
                          <AlertDescription>
                            <ul>
                              {migrationIssues.map((issue) => (
                                <li key={issue.id} className="flex flex-wrap items-center gap-2">
                                  <span>{issue.message}</span>
                                  {issue.severity === "blocking" ? (
                                    <>
                                      <strong>해결 필요</strong>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleResolveIssue(issue.id, "remove_target")
                                        }
                                        disabled={resolveIssueMutation.isPending}
                                      >
                                        목표 제거
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <span>참고</span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResolveIssue(issue.id, "acknowledge")}
                                        disabled={resolveIssueMutation.isPending}
                                      >
                                        확인
                                      </Button>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                      {targetsQuery.isPending && (
                        <div className="workspace-target-loading" role="status" aria-live="polite">
                          <span className="sr-only">목표 불러오는 중…</span>
                          <Skeleton className="h-7 w-1/3" />
                          <Skeleton className="h-24 w-full" />
                        </div>
                      )}
                      {targetsQuery.error !== null && targetsQuery.error !== undefined && (
                        <FieldError>{errorMessage(targetsQuery.error)}</FieldError>
                      )}
                      {workspaceView !== "results" && targetsQuery.data !== undefined && (
                        <WorkspaceScreen
                          view={workspaceView}
                          project={project}
                          sourceCount={rangeCountQuery.data?.totalOriginalCount ?? project.responseCount}
                          selectedQuestionId={selectedSurveyQuestionId}
                          targets={draftTargets as unknown as ProjectTargets}
                          migrationIssues={migrationIssues}
                          targetsInfeasible={feasibilityMutation.data?.status === "infeasible"}
                          targetUpdatePending={targetUpdateMutation.isPending}
                          synthesisPending={synthesisMutation.isPending}
                          targetError={
                            targetUpdateMutation.error !== null &&
                            targetUpdateMutation.error !== undefined
                              ? errorMessage(targetUpdateMutation.error)
                              : hasBlockingIssues
                                ? "해결되지 않은 목표 변경사항이 있어 생성을 진행할 수 없습니다."
                                : feasibilityMutation.data?.issues.length
                                  ? feasibilityMutation.data.issues
                                      .map((issue) => issue.message)
                                      .join(" ")
                                  : undefined
                          }
                          onTargetsChange={handleTargetDraftChange}
                          onGenerate={handleGenerate}
                          onTimestampRangeChange={setTimestampRange}
                        />
                      )}
                      {workspaceView === "results" &&
                        activeRunId !== null &&
                        (completedRunForRoute !== null || runQuery.data !== undefined) && (
                          <WorkspaceResultsScreen
                            completedRun={
                              completedRunForRoute ?? {
                                runId: activeRunId,
                                count: runQuery.data?.finalResponseCount ?? 0,
                                syntheticCount: Math.max(
                                  0,
                                  (runQuery.data?.finalResponseCount ?? 0) -
                                    (rangeCountQuery.data?.totalOriginalCount ?? project.responseCount),
                                ),
                              }
                            }
                            form={project.form as unknown as FormSnapshot}
                            runData={runQuery.data as unknown as RunDetailView | undefined}
                            aiEnabled={Boolean(aiStatusQuery.data?.enabled)}
                            aiPending={aiGenerateMutation.isPending}
                            aiFeedback={aiFeedback}
                            aiError={
                              aiGenerateMutation.error
                                ? errorMessage(aiGenerateMutation.error)
                                : undefined
                            }
                            onStartAi={handleStartAi}
                            onCancelAi={handleCancelAi}
                            onExport={handleExport}
                            exportPending={exportMutation.isPending}
                            exportFeedback={exportFeedback}
                            exportError={
                              exportMutation.error ? errorMessage(exportMutation.error) : undefined
                            }
                            onRegenerate={handleGenerate}
                            regeneratePending={synthesisMutation.isPending}
                          />
                        )}
                      <ApiKeyDialog
                        open={showApiKeyDialog}
                        onOpenChange={setShowApiKeyDialog}
                        onSave={(key) => aiConfigureMutation.mutate(key)}
                        pending={aiConfigureMutation.isPending}
                        error={
                          aiConfigureMutation.error
                            ? errorMessage(aiConfigureMutation.error)
                            : undefined
                        }
                      />
                      <AiDisclosureDialog
                        open={showDisclosureDialog}
                        onOpenChange={setShowDisclosureDialog}
                        onAgree={() => aiDisclosureMutation.mutate()}
                        pending={aiDisclosureMutation.isPending}
                        error={
                          aiDisclosureMutation.error
                            ? errorMessage(aiDisclosureMutation.error)
                            : undefined
                        }
                      />
                      {synthesisMutation.isPending && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelSynthesis}
                          disabled={cancelSynthesisMutation.isPending}
                        >
                          생성 취소
                        </Button>
                      )}
                      {synthesisMutation.data?.status === "success" && (
                        <p role="status" className="text-sm text-muted-foreground">
                          {synthesisMutation.data.syntheticResponseCount}명 증강 (최종{" "}
                          {synthesisMutation.data.finalResponseCount}명)
                        </p>
                      )}
                      {synthesisMutation.data !== undefined &&
                        synthesisMutation.data.status !== "success" && (
                          <FieldError>
                            {synthesisMutation.data.issues.map((issue) => issue.message).join(" ")}
                          </FieldError>
                        )}
                      {synthesisMutation.error !== null && (
                        <FieldError>{errorMessage(synthesisMutation.error)}</FieldError>
                      )}
                    </div>
                  );
                })()}
            </section>
            {selectedProjectId === null && !projectsQuery.isPending && (
              <Empty className="min-h-72 border">
                <EmptyHeader>
                  <EmptyTitle>프로젝트 없음</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={() => setNewProjectDialogOpen(true)}>
                    새 프로젝트
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </div>
          <ConfirmDeleteProjectDialog
            open={confirmDeleteProject}
            onOpenChange={setConfirmDeleteProject}
            onConfirm={() => {
              if (projectQuery.data !== undefined && projectQuery.data !== null) {
                deleteProjectMutation.mutate(projectQuery.data.id);
              }
            }}
            pending={deleteProjectMutation.isPending || projectQuery.data === undefined}
          />
          <ConfirmDeleteAccountDataDialog
            open={confirmDeleteAccountId !== null}
            onOpenChange={(open) => {
              if (!open) setConfirmDeleteAccountId(null);
            }}
            onConfirm={() => {
              if (confirmDeleteAccountId !== null) {
                deleteAccountDataMutation.mutate(confirmDeleteAccountId);
              }
            }}
            pending={deleteAccountDataMutation.isPending}
          />
          <ConfirmRevokeDialog
            open={confirmRevoke}
            onOpenChange={setConfirmRevoke}
            onConfirm={() => {
              setConfirmRevoke(false);
              handleRevoke();
            }}
            pending={revokeMutation.isPending}
          />
          <ConfirmAiClearDialog
            open={confirmAiCredentialClear}
            onOpenChange={setConfirmAiCredentialClear}
            onConfirm={() => aiClearCredentialsMutation.mutate()}
            pending={aiClearCredentialsMutation.isPending}
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
