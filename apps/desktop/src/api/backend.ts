import {
  BackendErrorSchema,
  type BackendError,
  type BackendRpc,
  createRequest,
  type FormId,
  type FormImportSummary,
  type FormsListParams,
  type FormsListResult,
  type GoogleAccountId,
  type GoogleAccountView,
  parseRpcResult,
  type ProjectDetailView,
  type ProjectSummaryView,
  type RpcMethod,
  type RunsGetResult,
  type SessionView,
  type SynthesisStartParams,
  type SynthesisStartResult,
  type ValueGroupObservedValue,
  type ValueGroupView,
} from "@survey-synth/contracts";

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

const electronInvoker: BackendInvoker = {
  invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (command !== "backend_call") throw new Error(`Unsupported desktop command: ${command}`);
    const request = args?.request;
    if (typeof request !== "string") throw new Error("Desktop backend request must be serialized JSON");
    return (await window.surveySynth.backendCall(request)) as T;
  },
};

let requestSequence = 0;
const nextRequestId = (): string => `ui_${++requestSequence}`;

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
  backend: BackendInvoker = electronInvoker,
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
export const deleteAccountData = (
  id: GoogleAccountId,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("auth.deleteAccountData", { id }, backend);

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
export const deleteProject = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("projects.delete", { projectId }, backend);

export const listValueGroups = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<ValueGroupView[]> => callBackend("valueGroups.list", { projectId }, backend);
export const listValueGroupValues = (
  projectId: string,
  questionId: string,
  backend?: BackendInvoker,
): Promise<ValueGroupObservedValue[]> =>
  callBackend("valueGroups.values", { projectId, questionId }, backend);
export const createValueGroup = (
  input: { projectId: string; questionId: string; name: string; members: string[] },
  backend?: BackendInvoker,
): Promise<ValueGroupView> => callBackend("valueGroups.create", input, backend);
export const deleteValueGroup = (
  valueGroupId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("valueGroups.delete", { valueGroupId }, backend);

export const startSynthesis = (
  params: SynthesisStartParams,
  backend?: BackendInvoker,
): Promise<SynthesisStartResult> => callBackend("synthesis.start", params, backend);
export const cancelSynthesis = (
  operationId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("synthesis.cancel", { operationId }, backend);
export const getRun = (
  runId: string,
  backend?: BackendInvoker,
): Promise<RunsGetResult> => callBackend("runs.get", { runId }, backend);
