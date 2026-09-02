import { invoke } from "@tauri-apps/api/core";
import {
  BackendErrorSchema,
  type FormId,
  type FormImportSummary,
  type FormsListParams,
  type FormsListResult,
  type GoogleAccountId,
  type GoogleAccountView,
  type SessionView,
  type BackendError,
  type ProjectSummaryView,
  type ProjectDetailView,
  type BackendRpc,
  createRequest,
  parseRpcResult,
  type RpcMethod,
  type SynthesisStartResult,
} from "@survey-synth/contracts";
import type { ProjectTargets } from "@survey-synth/domain";

export interface BackendInvoker {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export class BackendClientError extends Error {
  public readonly backendError: BackendError;

  public constructor(error: BackendError) {
    super(error.message);
    this.name = "BackendClientError";
    this.backendError = error;
  }
}

const tauriInvoker: BackendInvoker = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
};

let requestSequence = 0;

const nextRequestId = (): string => {
  requestSequence += 1;
  return `ui_${requestSequence}`;
};

const structuredError = (code: BackendError["code"], message: string): BackendError => ({
  code,
  message,
  recoverable:
    code === "VALIDATION_FAILED" || code === "BACKEND_UNAVAILABLE" || code === "INTERNAL",
});

const normalizeError = (value: unknown): BackendError => {
  const parsed = BackendErrorSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : structuredError("BACKEND_UNAVAILABLE", "Backend returned an invalid error");
};

export const callBackend = async <M extends RpcMethod>(
  method: M,
  params: BackendRpc[M]["input"],
  backend: BackendInvoker = tauriInvoker,
): Promise<BackendRpc[M]["output"]> => {
  let request: ReturnType<typeof createRequest<M>>;
  try {
    request = createRequest(nextRequestId(), method, params);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      throw new BackendClientError(
        structuredError("VALIDATION_FAILED", "Backend request parameters are invalid"),
      );
    }
    throw new BackendClientError(normalizeError(error));
  }

  try {
    const rawResponse = await backend.invoke<unknown>("backend_call", {
      request: JSON.stringify(request),
    });
    return parseRpcResult(method, rawResponse);
  } catch (error) {
    if (error instanceof BackendClientError) throw error;
    if (error instanceof Error && error.name === "ZodError") {
      throw new BackendClientError(
        structuredError("INTERNAL", "Backend returned an invalid response"),
      );
    }
    throw new BackendClientError(normalizeError(error));
  }
};

export const pingBackend = (backend?: BackendInvoker) => callBackend("system.ping", {}, backend);

export const getSession = (backend?: BackendInvoker): Promise<SessionView | null> =>
  callBackend("session.get", {}, backend);

export const login = (backend?: BackendInvoker): Promise<SessionView> =>
  callBackend("auth.login", {}, backend);

export const getAccounts = (backend?: BackendInvoker): Promise<GoogleAccountView[]> =>
  callBackend("auth.accounts", {}, backend);

export const addAccount = (backend?: BackendInvoker): Promise<SessionView> =>
  callBackend("auth.addAccount", {}, backend);

export const switchAccount = (
  id: GoogleAccountId,
  backend?: BackendInvoker,
): Promise<SessionView> => callBackend("auth.switchAccount", { id }, backend);

export const logout = (backend?: BackendInvoker): Promise<{ ok: true }> =>
  callBackend("auth.logout", {}, backend);

export const revokeAccess = (
  id: GoogleAccountId,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("auth.revokeAccess", { id }, backend);

export const listForms = (
  params: FormsListParams = {},
  backend?: BackendInvoker,
): Promise<FormsListResult> => callBackend("forms.list", params, backend);

export const importForm = (
  formId: FormId,
  operationIdOrBackend?: string | BackendInvoker,
  backend?: BackendInvoker,
): Promise<FormImportSummary> => {
  const operationId = typeof operationIdOrBackend === "string" ? operationIdOrBackend : undefined;
  const invoker = typeof operationIdOrBackend === "string" ? backend : operationIdOrBackend;
  return callBackend(
    "forms.import",
    { formId, ...(operationId === undefined ? {} : { operationId }) },
    invoker,
  );
};

export const cancelFormImport = (
  operationId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("forms.import.cancel", { operationId }, backend);

export const listProjects = (backend?: BackendInvoker): Promise<ProjectSummaryView[]> =>
  callBackend("projects.list", {}, backend);
export const getProject = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<ProjectDetailView | null> => callBackend("projects.get", { projectId }, backend);
export const deleteProject = (projectId: string, backend?: BackendInvoker): Promise<{ ok: true }> =>
  callBackend("projects.delete", { projectId }, backend);

export const getTargets = (projectId: string, backend?: BackendInvoker) =>
  callBackend("targets.get", { projectId }, backend);
export const updateTargets = (
  projectId: string,
  expectedRevision: number,
  targets: ProjectTargets,
  backend?: BackendInvoker,
) =>
  callBackend(
    "targets.update",
    {
      projectId,
      expectedRevision,
      targets: { ...targets, questionTargets: [...targets.questionTargets] },
    },
    backend,
  );

export const checkTargetFeasibility = (
  projectId: string,
  targets: ProjectTargets,
  backend?: BackendInvoker,
) =>
  callBackend(
    "targets.checkFeasibility",
    {
      projectId,
      targets: { ...targets, questionTargets: [...targets.questionTargets] },
    },
    backend,
  );

export const getRun = (runId: string, backend?: BackendInvoker) =>
  callBackend("runs.get", { runId }, backend);

export const startSynthesis = (
  projectId: string,
  targets: ProjectTargets,
  seed: number,
  operationId: string,
  backend?: BackendInvoker,
  targetRevision?: number,
): Promise<SynthesisStartResult> =>
  callBackend(
    "synthesis.start",
    {
      projectId,
      targets: { ...targets, questionTargets: [...targets.questionTargets] },
      ...(targetRevision === undefined ? {} : { targetRevision }),
      seed,
      operationId,
    },
    backend,
  );

export const cancelSynthesis = (
  operationId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("synthesis.cancel", { operationId }, backend);
