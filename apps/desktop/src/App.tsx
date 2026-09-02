import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";

import type { FormId, FormListItem, GoogleAccountId, SessionView } from "@survey-synth/contracts";
import type { FormSnapshot, ProjectTargets, QuestionTarget } from "@survey-synth/domain";

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
  getTargets,
  updateTargets,
  checkTargetFeasibility,
  getRun,
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

type ProjectEditorProps = {
  form: FormSnapshot;
  sourceCount: number;
  targets: ProjectTargets;
  onChange: (targets: ProjectTargets) => void;
  onGenerate: () => void;
  disabled: boolean;
  error?: string;
};

const profileFor = (profiles: readonly Record<string, unknown>[], questionId: string) =>
  profiles.find((profile) => profile.questionId === questionId);

const isNumericText = (profiles: readonly Record<string, unknown>[], questionId: string): boolean =>
  (profileFor(profiles, questionId)?.semanticInference as { inferred?: string } | undefined)
    ?.inferred === "numeric";

const TargetEditor = ({
  form,
  sourceCount,
  targets,
  onChange,
  onGenerate,
  disabled,
  error,
  profiles = [],
}: ProjectEditorProps & { profiles?: readonly Record<string, unknown>[] }) => {
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [unit, setUnit] = useState<"ratio" | "count">("ratio");
  const adjustableQuestions = form.questions.filter(
    (question) =>
      question.kind === "single_choice" ||
      question.kind === "ordinal" ||
      (question.kind === "text" && isNumericText(profiles, question.id)),
  );
  const targetFor = (questionId: string) =>
    targets.questionTargets.filter((target) => target.questionId === questionId);
  const addQuestion = (questionId: string) => {
    if (questionId === "") return;
    const question = form.questions.find((item) => item.id === questionId);
    if (question?.kind === "single_choice" && question.options[0] !== undefined) {
      onChange({
        ...targets,
        questionTargets: [
          ...targets.questionTargets,
          {
            kind: "option",
            questionId: question.id,
            optionKey: question.options[0].key,
            target: { kind: "ratio", value: 0.5 },
          },
        ],
      });
    } else if (question?.kind === "ordinal") {
      onChange({
        ...targets,
        questionTargets: [
          ...targets.questionTargets,
          {
            kind: "mean",
            questionId: question.id,
            target: { kind: "mean", value: (question.min + question.max) / 2 },
          },
        ],
      });
    } else if (question?.kind === "text" && isNumericText(profiles, question.id)) {
      const mean =
        (profileFor(profiles, question.id)?.numeric as { mean?: number } | undefined)?.mean ?? 0;
      onChange({
        ...targets,
        questionTargets: [
          ...targets.questionTargets,
          { kind: "mean", questionId: question.id, target: { kind: "mean", value: mean } },
        ],
      });
    }
    setSelectedQuestionId("");
  };
  const removeQuestion = (questionId: string) =>
    onChange({
      ...targets,
      questionTargets: targets.questionTargets.filter((target) => target.questionId !== questionId),
    });
  const updateTarget = (
    questionId: string,
    optionKey: string,
    value: string,
    semantic: "ratio" | "count",
  ) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextValue = semantic === "ratio" ? numeric / 100 : numeric;
    const next = targets.questionTargets.map((target) =>
      target.kind === "option" && target.questionId === questionId && target.optionKey === optionKey
        ? { ...target, target: { kind: semantic, value: nextValue } }
        : target,
    );
    onChange({ ...targets, questionTargets: next as QuestionTarget[] });
  };
  const updateMean = (questionId: string, value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const question = form.questions.find((item) => item.id === questionId);
    if (question?.kind === "ordinal" && (numeric < question.min || numeric > question.max)) return;
    onChange({
      ...targets,
      questionTargets: targets.questionTargets.map((target) =>
        target.kind === "mean" && target.questionId === questionId
          ? { ...target, target: { kind: "mean", value: numeric } }
          : target,
      ),
    });
  };
  return (
    <section className="target-editor" aria-labelledby="target-editor-title">
      <div className="count-editor">
        <span>{sourceCount} →</span>
        <label>
          <span className="visually-hidden">최종 응답 수</span>
          <input
            type="number"
            min={sourceCount}
            step="1"
            value={Number.isNaN(targets.targetResponseCount) ? "" : targets.targetResponseCount}
            onChange={(event) =>
              onChange({
                ...targets,
                targetResponseCount: event.target.value === "" ? NaN : Number(event.target.value),
              })
            }
            disabled={disabled}
            aria-invalid={
              targets.targetResponseCount < sourceCount ||
              !Number.isInteger(targets.targetResponseCount)
            }
          />
        </label>
        <span>명</span>
      </div>
      <h3 id="target-editor-title">조정할 문항</h3>
      <div className="question-picker">
        <select
          aria-label="조정할 문항 추가"
          value={selectedQuestionId}
          onChange={(event) => addQuestion(event.target.value)}
          disabled={disabled}
        >
          <option value="">+ 문항 추가</option>
          {adjustableQuestions
            .filter((question) => targetFor(question.id).length === 0)
            .map((question) => (
              <option key={question.id} value={question.id}>
                {question.title}
              </option>
            ))}
        </select>
      </div>
      <div className="target-list">
        {adjustableQuestions
          .filter((question) => targetFor(question.id).length > 0)
          .map((question) => {
            const target = targetFor(question.id)[0];
            if (target === undefined) return null;
            if (question.kind === "single_choice" && target.kind === "option") {
              const option = question.options.find((item) => item.key === target.optionKey);
              if (option === undefined) return null;
              const current = (
                profileFor(profiles, question.id)?.choices as
                  Record<string, { share: number }> | undefined
              )?.[String(option.key)]?.share;
              if (target.target.kind !== "ratio" && target.target.kind !== "count") return null;
              const displayValue =
                target.target.kind === "ratio" ? target.target.value * 100 : target.target.value;
              const derived =
                target.target.kind === "ratio"
                  ? 1 - target.target.value
                  : targets.targetResponseCount - target.target.value;
              return (
                <div className="target-row" key={question.id}>
                  <div className="target-row-head">
                    <strong>{question.title}</strong>
                    <button
                      type="button"
                      onClick={() => removeQuestion(question.id)}
                      aria-label={`${question.title} 목표 제거`}
                      disabled={disabled}
                    >
                      제거
                    </button>
                  </div>
                  <div className="unit-toggle" role="group" aria-label="표시 단위">
                    <button
                      type="button"
                      aria-pressed={unit === "ratio"}
                      onClick={() => setUnit("ratio")}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      aria-pressed={unit === "count"}
                      onClick={() => setUnit("count")}
                    >
                      명
                    </button>
                  </div>
                  <div className="choice-target">
                    <span>{option.label}</span>
                    <span className="muted">
                      현재 {current === undefined ? "-" : `${Math.round(current * 100)}%`}
                    </span>
                    <label>
                      <span className="visually-hidden">{option.label} 목표</span>
                      <input
                        type="number"
                        min="0"
                        max={unit === "ratio" ? 100 : targets.targetResponseCount}
                        step={unit === "ratio" ? 1 : 1}
                        value={
                          unit === "ratio"
                            ? displayValue
                            : target.target.kind === "ratio"
                              ? Math.round((displayValue * targets.targetResponseCount) / 100)
                              : displayValue
                        }
                        onChange={(event) =>
                          updateTarget(question.id, String(option.key), event.target.value, unit)
                        }
                        disabled={disabled}
                      />
                      {unit === "ratio" ? "%" : "명"}
                    </label>
                    <span className="derived">
                      ≈{" "}
                      {unit === "ratio"
                        ? `${Math.round(derived * 100)}%`
                        : `${Math.round(target.target.kind === "ratio" ? target.target.value * targets.targetResponseCount : derived)}명`}
                    </span>
                  </div>
                </div>
              );
            }
            if (question.kind === "ordinal" && target.kind === "mean")
              return (
                <div className="target-row" key={question.id}>
                  <div className="target-row-head">
                    <strong>{question.title}</strong>
                    <button
                      type="button"
                      onClick={() => removeQuestion(question.id)}
                      aria-label={`${question.title} 목표 제거`}
                      disabled={disabled}
                    >
                      제거
                    </button>
                  </div>
                  <p className="muted">현재 평균</p>
                  <label>
                    목표 평균{" "}
                    <input
                      type="number"
                      min={question.min}
                      max={question.max}
                      step="0.1"
                      value={target.target.value}
                      onChange={(event) => updateMean(question.id, event.target.value)}
                      disabled={disabled}
                    />
                  </label>
                </div>
              );
            if (
              question.kind === "text" &&
              target.kind === "mean" &&
              isNumericText(profiles, question.id)
            ) {
              const current = (
                profileFor(profiles, question.id)?.numeric as { mean?: number } | undefined
              )?.mean;
              return (
                <div className="target-row" key={question.id}>
                  <div className="target-row-head">
                    <strong>{question.title}</strong>
                    <button
                      type="button"
                      onClick={() => removeQuestion(question.id)}
                      aria-label={`${question.title} 목표 제거`}
                      disabled={disabled}
                    >
                      제거
                    </button>
                  </div>
                  <p className="muted">
                    현재 평균 {current === undefined ? "-" : current.toFixed(1)}
                  </p>
                  <label>
                    목표 평균{" "}
                    <input
                      type="number"
                      step="0.1"
                      value={target.target.value}
                      onChange={(event) => updateMean(question.id, event.target.value)}
                      disabled={disabled}
                    />
                  </label>
                </div>
              );
            }
            return null;
          })}
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      <button
        type="button"
        onClick={onGenerate}
        disabled={
          disabled ||
          !Number.isInteger(targets.targetResponseCount) ||
          targets.targetResponseCount < sourceCount
        }
      >
        데이터 생성
      </button>
    </section>
  );
};

export function App() {
  const queryClient = useQueryClient();
  const [formQuery, setFormQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [completedRun, setCompletedRun] = useState<{
    runId: string;
    count: number;
    syntheticCount: number;
  } | null>(null);
  const targetForm = useForm<ProjectTargets>({
    defaultValues: { targetResponseCount: 0, questionTargets: [] },
    mode: "onChange",
  });
  const draftTargets = useWatch({ control: targetForm.control });
  const targetReady = useRef(false);
  const targetRevision = useRef(0);
  const saveSequence = useRef(0);
  const appliedSaveSequence = useRef(0);
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
  const targetsQuery = useQuery({
    queryKey: ["targets.get", selectedProjectId],
    queryFn: () => getTargets(selectedProjectId ?? ""),
    enabled: selectedProjectId !== null,
    retry: false,
  });
  const runQuery = useQuery({
    queryKey: ["runs.get", completedRun?.runId],
    queryFn: () => getRun(completedRun?.runId ?? ""),
    enabled: completedRun !== null,
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
    }) => startSynthesis(projectId, targets, 1, operationId, undefined, targetRevision.current),
    onSuccess: (result) => {
      if (result.status !== "success" || selectedProjectId === null) return;
      setCompletedRun({
        runId: result.runId,
        count: result.finalResponseCount,
        syntheticCount: result.syntheticResponseCount,
      });
      window.history.pushState({}, "", `/projects/${selectedProjectId}/runs/${result.runId}`);
    },
  });
  const targetUpdateMutation = useMutation({
    mutationFn: ({
      revision,
      targets,
    }: {
      revision: number;
      targets: ProjectTargets;
      sequence: number;
    }) => updateTargets(selectedProjectId ?? "", revision, targets),
    onSuccess: (result, variables) => {
      if (variables.sequence < appliedSaveSequence.current) return;
      appliedSaveSequence.current = variables.sequence;
      targetRevision.current = result.revision;
      if (JSON.stringify(targetForm.getValues()) === JSON.stringify(result.targets))
        targetForm.reset(result.targets as unknown as ProjectTargets);
      void queryClient.invalidateQueries({ queryKey: ["targets.get", selectedProjectId] });
    },
  });
  const feasibilityMutation = useMutation({
    mutationFn: (targets: ProjectTargets) =>
      checkTargetFeasibility(selectedProjectId ?? "", targets),
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

  useEffect(() => {
    if (selectedProjectId === null || targetsQuery.data === undefined) return;
    targetRevision.current = targetsQuery.data.revision;
    targetForm.reset(targetsQuery.data.targets as unknown as ProjectTargets);
    targetReady.current = true;
  }, [selectedProjectId, targetsQuery.data, targetForm]);

  useEffect(() => {
    if (!targetReady.current || selectedProjectId === null) return;
    const timer = window.setTimeout(() => {
      const targets = draftTargets as ProjectTargets;
      if (!Number.isInteger(targets.targetResponseCount) || targets.targetResponseCount < 0) return;
      saveSequence.current += 1;
      targetUpdateMutation.mutate({
        revision: targetRevision.current,
        targets,
        sequence: saveSequence.current,
      });
      feasibilityMutation.mutate(targets);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftTargets, selectedProjectId]);

  useEffect(() => {
    const flush = (): void => {
      const targets = targetForm.getValues() as ProjectTargets;
      if (selectedProjectId === null || !Number.isInteger(targets.targetResponseCount)) return;
      void targetUpdateMutation.mutateAsync({
        revision: targetRevision.current,
        targets,
        sequence: ++saveSequence.current,
      });
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [selectedProjectId, targetForm, targetUpdateMutation]);

  const flushTargets = async (): Promise<void> => {
    const targets = targetForm.getValues() as ProjectTargets;
    if (selectedProjectId === null || !Number.isInteger(targets.targetResponseCount)) return;
    await targetUpdateMutation.mutateAsync({
      revision: targetRevision.current,
      targets,
      sequence: ++saveSequence.current,
    });
  };

  const handleLogin = (): void => {
    loginMutation.mutate();
  };

  const handleAddAccount = (): void => {
    void flushTargets().then(() => addAccountMutation.mutate());
  };

  const handleSwitchAccount = (id: GoogleAccountId): void => {
    void flushTargets().then(() => switchAccountMutation.mutate(id));
  };

  const handleLogout = (): void => {
    void flushTargets().then(() => logoutMutation.mutate());
  };

  const handleRevoke = (): void => {
    if (activeAccountId === null || !window.confirm("Google 접근 권한을 해제하시겠습니까?")) return;
    void flushTargets().then(() => revokeMutation.mutate(activeAccountId));
  };

  const handleImport = (formId: FormId): void => {
    importMutation.mutate({ formId, operationId: crypto.randomUUID() });
  };

  const handleCancelImport = (): void => {
    if (importOperationId === undefined) return;
    cancelMutation.mutate(importOperationId);
  };
  const handleProjectSelect = (projectId: string): void => {
    void flushTargets().then(() => {
      setCompletedRun(null);
      setSelectedProjectId(projectId);
    });
  };
  const handleGenerate = (): void => {
    if (selectedProjectId === null) return;
    const targets = draftTargets as ProjectTargets;
    if (!Number.isInteger(targets.targetResponseCount) || targets.targetResponseCount < 0) return;
    saveSequence.current += 1;
    targetUpdateMutation.mutate(
      {
        revision: targetRevision.current,
        targets,
        sequence: saveSequence.current,
      },
      {
        onSuccess: (result) =>
          synthesisMutation.mutate({
            projectId: selectedProjectId,
            targets: result.targets as unknown as ProjectTargets,
            operationId: crypto.randomUUID(),
          }),
      },
    );
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
                onClick={() => handleProjectSelect(project.id)}
              >
                <span>{project.name}</span>
                <span>{project.responseCount}개 응답</span>
              </button>
            </li>
          ))}
        </ul>
        {projectQuery.data !== undefined && projectQuery.data !== null && (
          <div aria-live="polite">
            <p className="project-title">{projectQuery.data.name}</p>
            {targetsQuery.isPending && <p>불러오는 중…</p>}
            {targetsQuery.error !== null && targetsQuery.error !== undefined && (
              <p role="alert">{errorMessage(targetsQuery.error)}</p>
            )}
            {targetsQuery.data !== undefined && (
              <TargetEditor
                form={projectQuery.data.form as unknown as FormSnapshot}
                sourceCount={projectQuery.data.responseCount}
                targets={draftTargets as unknown as ProjectTargets}
                profiles={projectQuery.data.profiles}
                onChange={(targets) => targetForm.reset(targets, { keepDirty: true })}
                onGenerate={handleGenerate}
                disabled={
                  synthesisMutation.isPending ||
                  targetUpdateMutation.isPending ||
                  feasibilityMutation.data?.status === "infeasible"
                }
                error={
                  targetUpdateMutation.error !== null && targetUpdateMutation.error !== undefined
                    ? errorMessage(targetUpdateMutation.error)
                    : feasibilityMutation.data?.issues.length
                      ? feasibilityMutation.data.issues.map((issue) => issue.message).join(" ")
                      : undefined
                }
              />
            )}
            {completedRun !== null && (
              <section className="result-summary" aria-labelledby="result-title">
                <h3 id="result-title">{projectQuery.data.name}</h3>
                <p>
                  {completedRun.syntheticCount}명 증강 (최종 {completedRun.count}명)
                </p>
                {runQuery.data !== undefined && (
                  <table>
                    <thead>
                      <tr>
                        <th>목표</th>
                        <th>결과</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        (runQuery.data.validation.metrics as
                          | Array<{
                              requested: { kind: string; value?: number };
                              actual: number | null;
                            }>
                          | undefined) ?? []
                      ).map((metric, index) => (
                        <tr key={index}>
                          <td>{metric.requested.value ?? "-"}</td>
                          <td>{metric.actual ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={synthesisMutation.isPending}
                >
                  결과 다시 만들기
                </button>
              </section>
            )}
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
              <p role="status">
                {synthesisMutation.data.syntheticResponseCount}명 증강 (최종{" "}
                {synthesisMutation.data.finalResponseCount}명)
              </p>
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
