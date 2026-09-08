import { useCallback, useEffect, useRef, useState } from "react";

import type {
  FormImportResult,
  FormListItem,
  ProjectDetailView,
  ProjectSourceReviewResult,
  ProjectSummaryView,
  SessionView,
} from "@survey-synth/contracts";

import {
  cancelFormImport,
  deleteProject,
  getProject,
  getProjectSourceReview,
  getSession,
  importForm,
  listForms,
  listProjects,
  login,
  logout,
  openProjectWorkspace,
  pingBackend,
  refreshProjectSource,
} from "./api/backend";
import { appShellErrorMessage } from "./appShellError";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QuestionExplorerPanel } from "./QuestionExplorerPanel";
import {
  filterProjectChoices,
  promoteProjectChoice,
  recentProjectChoices,
} from "./projectSwitcher";
import { recoverAppliedSourceRefresh } from "./sourceRefreshRecovery";

type RuntimeState = "checking" | "ready" | "error";

export function AppShell() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("checking");
  const [message, setMessage] = useState("앱을 준비하고 있습니다…");
  const [session, setSession] = useState<SessionView | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetailView | null>(null);
  const [projectsBusy, setProjectsBusy] = useState(false);
  const [sourceReview, setSourceReview] = useState<ProjectSourceReviewResult | null>(null);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [formsBusy, setFormsBusy] = useState(false);
  const [importOperationId, setImportOperationId] = useState<string | null>(null);
  const [importingFormId, setImportingFormId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<FormImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeDraftFlushRef = useRef<(() => Promise<void>) | null>(null);

  const registerDraftFlush = useCallback((flush: (() => Promise<void>) | null): void => {
    activeDraftFlushRef.current = flush;
  }, []);

  const flushActiveDraft = useCallback(async (): Promise<boolean> => {
    const flush = activeDraftFlushRef.current;
    if (!flush) return true;
    try {
      await flush();
      return true;
    } catch {
      setError("변경사항을 저장하지 못했습니다. 다시 시도해주세요.");
      return false;
    }
  }, []);

  useEffect(
    () =>
      window.surveySynth.onBeforeClose(async () => {
        const saved = await flushActiveDraft();
        return saved;
      }),
    [flushActiveDraft],
  );

  useEffect(() => {
    let active = true;

    void pingBackend()
      .then(async () => {
        const restored = await getSession();
        if (!active) return;
        setSession(restored);
        setRuntimeState("ready");
        setMessage("");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setRuntimeState("error");
        setMessage(appShellErrorMessage(cause, "startup"));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setForms([]);
      setProjects([]);
      setSelectedProject(null);
      setSourceReview(null);
      setRefreshDialogOpen(false);
      setProjectSearchOpen(false);
      setProjectSearchQuery("");
      return;
    }

    let active = true;
    setFormsBusy(true);
    setProjectsBusy(true);
    setSelectedProject(null);
    setSourceReview(null);
    setError(null);

    void Promise.all([listForms(), listProjects()])
      .then(async ([formsResult, projectResult]) => {
        if (!active) return;
        setForms(formsResult.items);
        setProjects(projectResult);
        const initialProject = projectResult[0];
        if (!initialProject) return;

        const project = await openProjectWorkspace(initialProject.id);
        if (!active) return;
        setSelectedProject(project);
        if (project) {
          try {
            setSourceReview(await getProjectSourceReview(project.id));
          } catch {
            if (active) setError("프로젝트는 열었지만 확인할 설정 상태를 불러오지 못했습니다.");
          }
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(appShellErrorMessage(cause, "load_home"));
      })
      .finally(() => {
        if (!active) return;
        setFormsBusy(false);
        setProjectsBusy(false);
      });

    return () => {
      active = false;
    };
  }, [session?.account.id]);

  const openProject = async (projectId: string): Promise<void> => {
    setProjectsBusy(true);
    setError(null);
    try {
      setSourceReview(null);
      const project = await openProjectWorkspace(projectId);
      setSelectedProject(project);
      if (project) {
        setProjects((current) => promoteProjectChoice(current, project.id));
        try {
          setSourceReview(await getProjectSourceReview(projectId));
        } catch {
          setError("프로젝트는 열었지만 확인할 설정 상태를 불러오지 못했습니다.");
        }
      }
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "open_project"));
    } finally {
      setProjectsBusy(false);
    }
  };

  const handleLogin = async (): Promise<void> => {
    setAuthBusy(true);
    setError(null);
    try {
      setSession(await login());
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "login"));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setAuthBusy(true);
    setError(null);
    try {
      if (!(await flushActiveDraft())) return;
      await logout();
      setSession(null);
      setSelectedProject(null);
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "logout"));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleImport = async (form: FormListItem): Promise<void> => {
    const operationId = `form-import-${Date.now()}`;
    setImportOperationId(operationId);
    setImportingFormId(form.formId);
    setImportSummary(null);
    setError(null);

    try {
      const summary = await importForm(form.formId, operationId);
      setImportSummary(summary);
      setProjects(await listProjects());
      await openProject(summary.projectId);
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "import_form"));
    } finally {
      setImportOperationId(null);
      setImportingFormId(null);
    }
  };

  const handleCancelImport = async (): Promise<void> => {
    if (!importOperationId) return;
    setError(null);
    try {
      await cancelFormImport(importOperationId);
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "cancel_import"));
    }
  };

  const handleRefreshProject = async (): Promise<void> => {
    if (!selectedProject) return;
    const previousSourceRevisionId = selectedProject.currentSourceRevisionId;
    setRefreshBusy(true);
    setError(null);
    try {
      if (!(await flushActiveDraft())) return;
      const result = await refreshProjectSource(selectedProject.id, `source-refresh-${Date.now()}`);
      setSelectedProject(result.project);
      setSourceReview({
        projectId: result.project.id,
        sourceRevisionId: result.sourceRevisionId,
        invalidValueGroupIds: result.invalidValueGroupIds,
        targetIssues: result.targetIssues,
      });
      setRefreshDialogOpen(false);
      try {
        setProjects(await listProjects());
      } catch {
        setError("원본은 업데이트됐지만 프로젝트 목록을 새로고치지 못했습니다.");
      }
    } catch (cause: unknown) {
      const recovery = await recoverAppliedSourceRefresh({
        projectId: selectedProject.id,
        previousSourceRevisionId,
        getProject,
        getSourceReview: getProjectSourceReview,
      });
      if (recovery.status === "applied") {
        setSelectedProject(recovery.project);
        setSourceReview(recovery.review);
        setRefreshDialogOpen(false);
        let listReloadFailed = false;
        try {
          setProjects(await listProjects());
        } catch {
          listReloadFailed = true;
        }
        setError(
          recovery.review === null
            ? "원본은 업데이트됐지만 확인할 설정 상태를 불러오지 못했습니다."
            : listReloadFailed
              ? "원본은 업데이트됐지만 프로젝트 목록을 새로고치지 못했습니다."
              : null,
        );
      } else {
        setError(appShellErrorMessage(cause, "refresh_source"));
      }
    } finally {
      setRefreshBusy(false);
    }
  };

  const switchProject = async (projectId: string): Promise<void> => {
    if (selectedProject?.id === projectId) {
      setProjectSearchOpen(false);
      setProjectSearchQuery("");
      return;
    }
    if (selectedProject && !(await flushActiveDraft())) return;
    await openProject(projectId);
    setProjectSearchOpen(false);
    setProjectSearchQuery("");
  };

  const handleProjectChange = async (): Promise<void> => {
    setProjectsBusy(true);
    setError(null);
    try {
      if (!(await flushActiveDraft())) return;
      setSelectedProject(null);
      setSourceReview(null);
      setProjectSearchOpen(false);
      setProjectSearchQuery("");
    } finally {
      setProjectsBusy(false);
    }
  };

  const handleDeleteProject = async (project: ProjectSummaryView): Promise<void> => {
    if (
      !window.confirm(
        `“${project.name}” 프로젝트를 삭제할까요? Google Form 원본은 변경되지 않습니다.`,
      )
    ) {
      return;
    }

    setProjectsBusy(true);
    setError(null);
    try {
      await deleteProject(project.id);
      if (selectedProject?.id === project.id) setSelectedProject(null);
      setProjects(await listProjects());
    } catch (cause: unknown) {
      setError(appShellErrorMessage(cause, "delete_project"));
    } finally {
      setProjectsBusy(false);
    }
  };

  const recentProjects = recentProjectChoices(projects, selectedProject?.id ?? null);
  const filteredProjects = filterProjectChoices(projects, projectSearchQuery);

  if (runtimeState !== "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">{message}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <section className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold tracking-tight">Survey Data Generator</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Google Forms의 기존 응답을 바탕으로 원하는 분포의 응답 데이터를 만듭니다.
          </p>
          <Button className="mt-6" disabled={authBusy} onClick={() => void handleLogin()}>
            {authBusy ? "연결 중…" : "Google로 계속"}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            프로젝트와 생성 결과는 이 기기에 저장됩니다.
          </p>
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden shrink-0 text-sm font-semibold sm:inline">
            Survey Data Generator
          </span>
          {selectedProject ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="max-w-[280px] justify-start px-2 font-medium"
                    disabled={projectsBusy || refreshBusy}
                  >
                    <span className="truncate">{selectedProject.name}</span>
                    <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                      ▾
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-[280px]">
                <DropdownMenuLabel>최근 프로젝트</DropdownMenuLabel>
                {recentProjects.length > 0 ? (
                  recentProjects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      className="items-start py-2"
                      onClick={() => void switchProject(project.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{project.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          응답 {project.responseCount}개 · 문항 {project.questionCount}개
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>다른 최근 프로젝트가 없습니다.</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProjectSearchOpen(true)}>
                  프로젝트 검색…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleProjectChange()}>
                  새 프로젝트
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleProjectChange()}>
                  모든 프로젝트 보기
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-sm font-medium">프로젝트</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedProject ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={refreshBusy}
              onClick={() => setRefreshDialogOpen(true)}
            >
              원본 업데이트
            </Button>
          ) : null}
          <span className="hidden text-xs text-muted-foreground md:inline">
            {session.account.email}
          </span>
          <Button size="sm" variant="ghost" disabled={authBusy} onClick={() => void handleLogout()}>
            로그아웃
          </Button>
        </div>
      </header>

      {selectedProject ? (
        <div className="mx-auto w-full max-w-[1440px] px-4 py-3">
          <QuestionExplorerPanel
            project={selectedProject}
            sourceReview={sourceReview}
            onDraftFlushReady={registerDraftFlush}
          />
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-6 py-10 md:grid-cols-2">
          <section>
            <h1 className="text-lg font-semibold tracking-tight">프로젝트</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              최근 작업을 열거나 새 Google Form을 가져오세요.
            </p>
            <div className="mt-5 divide-y border-y">
              {projects.map((project) => (
                <div key={project.id} className="flex items-center justify-between gap-4 py-3">
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    disabled={projectsBusy}
                    onClick={() => void switchProject(project.id)}
                  >
                    <p className="truncate text-sm font-medium">{project.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      응답 {project.responseCount}개 · 문항 {project.questionCount}개
                    </p>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={projectsBusy}
                    onClick={() => void handleDeleteProject(project)}
                  >
                    삭제
                  </Button>
                </div>
              ))}
              {!projectsBusy && projects.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">아직 만든 프로젝트가 없습니다.</p>
              ) : null}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">Google Forms</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              사용할 Form을 선택해 프로젝트를 만듭니다.
            </p>
            <div className="mt-5 divide-y border-y">
              {forms.map((form) => (
                <div key={form.formId} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{form.title}</p>
                    {form.modifiedAt ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">수정 {form.modifiedAt}</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={formsBusy || importingFormId !== null}
                    onClick={() => void handleImport(form)}
                  >
                    {importingFormId === form.formId ? "가져오는 중…" : "가져오기"}
                  </Button>
                </div>
              ))}
              {!formsBusy && forms.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">
                  접근 가능한 Google Form이 없습니다.
                </p>
              ) : null}
            </div>
            {importOperationId ? (
              <Button
                className="mt-3"
                size="sm"
                variant="ghost"
                onClick={() => void handleCancelImport()}
              >
                가져오기 취소
              </Button>
            ) : null}
            {importSummary ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {importSummary.title} 프로젝트를 만들었습니다.
              </p>
            ) : null}
          </section>
        </div>
      )}

      <Dialog
        open={projectSearchOpen}
        onOpenChange={(open) => {
          setProjectSearchOpen(open);
          if (!open) setProjectSearchQuery("");
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>프로젝트 검색</DialogTitle>
            <DialogDescription>
              최근 프로젝트를 포함해 이 기기에 저장된 프로젝트를 찾습니다.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={projectSearchQuery}
            onChange={(event) => setProjectSearchQuery(event.target.value)}
            placeholder="프로젝트 이름 검색"
          />
          <div className="max-h-[320px] divide-y overflow-y-auto border-y">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="flex w-full items-center justify-between gap-4 py-3 text-left disabled:opacity-50"
                disabled={projectsBusy || project.id === selectedProject?.id}
                onClick={() => void switchProject(project.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{project.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    응답 {project.responseCount}개 · 문항 {project.questionCount}개
                  </span>
                </span>
                {project.id === selectedProject?.id ? (
                  <span className="shrink-0 text-xs text-muted-foreground">현재</span>
                ) : null}
              </button>
            ))}
            {filteredProjects.length === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">일치하는 프로젝트가 없습니다.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={refreshDialogOpen} onOpenChange={setRefreshDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Google Forms 원본을 업데이트할까요?</DialogTitle>
            <DialogDescription>
              현재 문항과 응답을 다시 가져와 새 원본 버전으로 적용합니다. Google Forms의 문항과 응답
              자체는 변경하지 않습니다. 이전 원본과 생성 결과는 그대로 보존됩니다.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            바뀐 문항이나 선택지 때문에 확인이 필요한 설정이 생기면 업데이트 후 작업공간에
            표시됩니다.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={refreshBusy}
              onClick={() => setRefreshDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={refreshBusy}
              onClick={() => void handleRefreshProject()}
            >
              {refreshBusy ? "가져오는 중…" : "업데이트"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error ? (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border bg-background px-3 py-2 text-sm text-destructive shadow-sm"
        >
          {error}
        </p>
      ) : null}
    </main>
  );
}
