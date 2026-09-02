import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { FormId, FormListItem, GoogleAccountId, SessionView } from "@survey-synth/contracts";
import type { ProjectTargets } from "@survey-synth/domain";

import {
  BackendClientError,
  addAccount,
  cancelFormImport,
  getAccounts,
  getProject,
  getSession,
  importForm,
  listForms,
  login,
  listProjects,
  logout,
  revokeAccess,
  switchAccount,
  cancelSynthesis,
  startSynthesis,
} from "./api/backend";

export const sessionQueryKey = ["session.get"] as const;

export const accountsQueryKey = (accountId: GoogleAccountId | null) =>
  ["auth.accounts", accountId] as const;

export const formsQueryKey = (accountId: GoogleAccountId | null, query: string) =>
  ["forms.list", accountId, query] as const;
export const projectsQueryKey = ["projects.list"] as const;

const errorMessage = (error: unknown): string => {
  if (error instanceof BackendClientError) return error.backendError.message;
  return "Backend unavailable";
};

const mergeForms = (
  current: readonly FormListItem[],
  next: readonly FormListItem[],
): FormListItem[] => {
  const merged = new Map(current.map((item) => [item.formId, item]));
  for (const item of next) merged.set(item.formId, item);
  return [...merged.values()];
};

const formatModifiedAt = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(date);
};

const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

export function App() {
  const queryClient = useQueryClient();
  const [formQuery, setFormQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [finalResponseCount, setFinalResponseCount] = useState(0);
  const [targetQuestionId, setTargetQuestionId] = useState("");
  const [targetOptionKey, setTargetOptionKey] = useState("");
  const [targetRatio, setTargetRatio] = useState("0.5");
  const debouncedFormQuery = useDebouncedValue(formQuery, 250);

  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => getSession(),
    retry: false,
  });
  const session = sessionQuery.data;
  const activeAccountId = session?.account.id ?? null;
  const projectsQuery = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => listProjects(),
    retry: false,
  });
  const projectQuery = useQuery({
    queryKey: ["projects.get", selectedProjectId],
    queryFn: () => getProject(selectedProjectId ?? ""),
    enabled: selectedProjectId !== null,
    retry: false,
  });
  const accountsQuery = useQuery({
    queryKey: accountsQueryKey(activeAccountId),
    queryFn: () => getAccounts(),
    enabled: activeAccountId !== null,
    retry: false,
  });
  const formsQuery = useInfiniteQuery({
    queryKey: formsQueryKey(activeAccountId, debouncedFormQuery),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listForms({
        ...(debouncedFormQuery.length === 0 ? {} : { query: debouncedFormQuery }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: activeAccountId !== null,
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
  const importMutation = useMutation({
    mutationFn: ({ formId, operationId }: { formId: FormId; operationId: string }) =>
      importForm(formId, operationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectsQueryKey }),
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
    }) => startSynthesis(projectId, targets, 1, operationId),
  });
  const cancelSynthesisMutation = useMutation({
    mutationFn: (operationId: string) => cancelSynthesis(operationId),
  });

  const importOperationId = importMutation.variables?.operationId;
  const synthesisOperationId = synthesisMutation.variables?.operationId;
  const authBusy =
    loginMutation.isPending ||
    addAccountMutation.isPending ||
    switchAccountMutation.isPending ||
    logoutMutation.isPending ||
    revokeMutation.isPending;
  const importBusy = importMutation.isPending || cancelMutation.isPending;
  const busy = authBusy || importBusy;
  const forms = (formsQuery.data?.pages ?? []).reduce<FormListItem[]>(
    (current, page) => mergeForms(current, page.items),
    [],
  );
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
    importMutation.reset();
    cancelMutation.reset();
  }, [activeAccountId]);

  const handleLogin = (): void => {
    loginMutation.mutate();
  };

  const handleAddAccount = (): void => {
    addAccountMutation.mutate();
  };

  const handleSwitchAccount = (id: GoogleAccountId): void => {
    switchAccountMutation.mutate(id);
  };

  const handleLogout = (): void => {
    logoutMutation.mutate();
  };

  const handleRevoke = (): void => {
    if (activeAccountId === null || !window.confirm("Google 접근 권한을 해제하시겠습니까?")) return;
    revokeMutation.mutate(activeAccountId);
  };

  const handleImport = (formId: FormId): void => {
    importMutation.mutate({ formId, operationId: crypto.randomUUID() });
  };

  const handleCancelImport = (): void => {
    if (importOperationId === undefined) return;
    cancelMutation.mutate(importOperationId);
  };
  const handleGenerate = (): void => {
    if (
      selectedProjectId === null ||
      !Number.isInteger(finalResponseCount) ||
      finalResponseCount < 0
    )
      return;
    const questionTargets =
      targetQuestionId.trim() === "" || targetOptionKey.trim() === ""
        ? []
        : [
            {
              kind: "option" as const,
              questionId: targetQuestionId.trim() as never,
              optionKey: targetOptionKey.trim() as never,
              target: { kind: "ratio" as const, value: Number(targetRatio) },
            },
          ];
    synthesisMutation.mutate({
      projectId: selectedProjectId,
      targets: { targetResponseCount: finalResponseCount, questionTargets },
      operationId: crypto.randomUUID(),
    });
  };
  const handleCancelSynthesis = (): void => {
    if (synthesisOperationId !== undefined) cancelSynthesisMutation.mutate(synthesisOperationId);
  };

  if (sessionQuery.isPending) {
    return (
      <main>
        <h1>Survey Synth</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (session === null || session === undefined) {
    return (
      <main>
        <h1>Survey Synth</h1>
        <button type="button" onClick={handleLogin} disabled={busy}>
          {loginMutation.isPending ? "Google 로그인 중…" : "Google로 계속하기"}
        </button>
        {(sessionError ?? actionError) !== null && (sessionError ?? actionError) !== undefined && (
          <p role="alert">{errorMessage(sessionError ?? actionError)}</p>
        )}
      </main>
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
    <main>
      <h1>Survey Synth</h1>
      <p>{session.account.email}</p>
      <details>
        <summary>계정 메뉴</summary>
        <div className="account-menu">
          <p>저장된 Google 계정</p>
          <ul>
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => handleSwitchAccount(account.id)}
                  disabled={busy || account.id === session.account.id}
                >
                  {account.email}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleAddAccount} disabled={busy}>
            {addAccountMutation.isPending ? "Google 계정 추가 중…" : "Google 계정 추가"}
          </button>
          <button type="button" onClick={handleLogout} disabled={busy}>
            로그아웃
          </button>
          <button type="button" onClick={handleRevoke} disabled={busy}>
            Google 접근 권한 해제
          </button>
        </div>
      </details>
      {(accountsQuery.error ?? actionError) !== null &&
        (accountsQuery.error ?? actionError) !== undefined && (
          <p role="alert">{errorMessage(accountsQuery.error ?? actionError)}</p>
        )}

      <section className="new-project" aria-labelledby="new-project-title">
        <h2 id="new-project-title">새 프로젝트</h2>
        <label className="visually-hidden" htmlFor="form-search">
          Google Form 검색
        </label>
        <input
          id="form-search"
          type="search"
          placeholder="Google Form 검색..."
          value={formQuery}
          onChange={(event) => setFormQuery(event.target.value)}
          disabled={importBusy}
        />
        {formsError !== null && formsError !== undefined && (
          <p role="alert">{errorMessage(formsError)}</p>
        )}
        {importError !== null && importError !== undefined && (
          <p role="alert">{errorMessage(importError)}</p>
        )}
        {cancelMutation.error !== null && cancelMutation.error !== undefined && (
          <p role="alert">{errorMessage(cancelMutation.error)}</p>
        )}
        {importBusy && (
          <button type="button" onClick={handleCancelImport} disabled={cancelMutation.isPending}>
            {cancelMutation.isPending ? "가져오기 취소 중…" : "가져오기 취소"}
          </button>
        )}
        {formsLoading && <p>불러오는 중…</p>}
        {!formsLoading && forms.length === 0 && formsError === null && formsError === undefined && (
          <p>Google Form이 없습니다.</p>
        )}
        <ul className="form-list">
          {forms.map((form) => {
            const modifiedAt = formatModifiedAt(form.modifiedAt);
            return (
              <li key={form.formId}>
                <button
                  className="form-item"
                  type="button"
                  onClick={() => handleImport(form.formId)}
                  disabled={busy}
                >
                  <span>{form.title}</span>
                  {modifiedAt !== undefined && <time dateTime={form.modifiedAt}>{modifiedAt}</time>}
                </button>
              </li>
            );
          })}
        </ul>
        {formsQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => void formsQuery.fetchNextPage()}
            disabled={busy || formsQuery.isFetchingNextPage}
          >
            더 보기
          </button>
        )}
        {importStatus !== undefined && <p role="status">{importStatus}</p>}
      </section>
      <section aria-labelledby="projects-title">
        <h2 id="projects-title">프로젝트</h2>
        {projectsQuery.error !== null && projectsQuery.error !== undefined && (
          <p role="alert">{errorMessage(projectsQuery.error)}</p>
        )}
        {!projectsQuery.isPending && projectsQuery.data?.length === 0 && (
          <p>저장된 프로젝트가 없습니다.</p>
        )}
        <ul className="form-list">
          {projectsQuery.data?.map((project) => (
            <li key={project.id} className="form-item">
              <button
                type="button"
                className="project-item"
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span>{project.name}</span>
                <span>{project.responseCount}개 응답</span>
              </button>
            </li>
          ))}
        </ul>
        {projectQuery.data !== undefined && projectQuery.data !== null && (
          <div aria-live="polite">
            <p>{projectQuery.data.name}</p>
            <p>
              질문 {projectQuery.data.questionCount}개 · 프로필 {projectQuery.data.profileCount}개 ·
              로컬 저장됨
            </p>
            <label>
              최종 응답 수
              <input
                type="number"
                min="0"
                value={finalResponseCount || projectQuery.data.responseCount}
                onChange={(event) => setFinalResponseCount(Number(event.target.value))}
                disabled={synthesisMutation.isPending}
              />
            </label>
            <details>
              <summary>기본 비율 목표</summary>
              <label>
                질문 ID
                <input
                  value={targetQuestionId}
                  onChange={(event) => setTargetQuestionId(event.target.value)}
                  disabled={synthesisMutation.isPending}
                />
              </label>
              <label>
                옵션 키
                <input
                  value={targetOptionKey}
                  onChange={(event) => setTargetOptionKey(event.target.value)}
                  disabled={synthesisMutation.isPending}
                />
              </label>
              <label>
                비율
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={targetRatio}
                  onChange={(event) => setTargetRatio(event.target.value)}
                  disabled={synthesisMutation.isPending}
                />
              </label>
            </details>
            <button type="button" onClick={handleGenerate} disabled={synthesisMutation.isPending}>
              생성
            </button>
            {synthesisMutation.isPending && (
              <button
                type="button"
                onClick={handleCancelSynthesis}
                disabled={cancelSynthesisMutation.isPending}
              >
                생성 취소
              </button>
            )}
            {synthesisMutation.data?.status === "success" && (
              <p role="status">{synthesisMutation.data.finalResponseCount}개 응답 생성</p>
            )}
            {synthesisMutation.data !== undefined &&
              synthesisMutation.data.status !== "success" && (
                <p role="alert">
                  {synthesisMutation.data.issues.map((issue) => issue.message).join(" ")}
                </p>
              )}
            {synthesisMutation.error !== null && (
              <p role="alert">{errorMessage(synthesisMutation.error)}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
