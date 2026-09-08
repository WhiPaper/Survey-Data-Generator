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
  type GoogleAccountListItem,
  type LikertScoreMapping,
  parseRpcResult,
  type ProjectDetailView,
  type ProjectSourceRefreshResult,
  type ProjectSourceReviewResult,
  type ProjectSummaryView,
  type RpcMethod,
  type RunExportFormat,
  type RunSummary,
  type RunsExportResult,
  type RunsGetResult,
  type SessionView,
  type SourceScope,
  type SynthesisStartParams,
  type SynthesisStartResult,
  type SynthesisSuccessResult,
  type TargetDraft,
  type TargetDraftView,
  type TargetProfileResult,
  type TargetsValidateResult,
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
    if (typeof request !== "string")
      throw new Error("Desktop backend request must be serialized JSON");
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
      console.error("backend_response_invalid", {
        method,
        errorCategory: "ZOD_RESPONSE",
        errorType: error.name,
        errorMessage: error.message,
      });
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
export const getAccounts = (backend?: BackendInvoker): Promise<GoogleAccountListItem[]> =>
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
export const importFormProject = (
  formId: FormId,
  projectName: string,
  operationId?: string,
  backend?: BackendInvoker,
): Promise<FormImportSummary> =>
  callBackend(
    "forms.import",
    { formId, projectName, ...(operationId === undefined ? {} : { operationId }) },
    backend,
  );
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
export const openProjectWorkspace = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<ProjectDetailView | null> => callBackend("projects.open", { projectId }, backend);
export const getProjectSourceReview = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<ProjectSourceReviewResult> =>
  callBackend("projects.sourceReview", { projectId }, backend);
export const refreshProjectSource = (
  projectId: string,
  operationId?: string,
  backend?: BackendInvoker,
): Promise<ProjectSourceRefreshResult> =>
  callBackend(
    "projects.refreshSource",
    { projectId, ...(operationId === undefined ? {} : { operationId }) },
    backend,
  );
export const deleteProject = (projectId: string, backend?: BackendInvoker): Promise<{ ok: true }> =>
  callBackend("projects.delete", { projectId }, backend);

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

export const getTargetProfile = (
  projectId: string,
  sourceScope?: SourceScope,
  scoreMappings?: LikertScoreMapping[],
  backend?: BackendInvoker,
): Promise<TargetProfileResult> =>
  callBackend(
    "targets.profile",
    {
      projectId,
      ...(sourceScope === undefined ? {} : { sourceScope }),
      ...(scoreMappings === undefined ? {} : { scoreMappings }),
    },
    backend,
  );
export const validateTargetDraft = (
  draft: TargetDraft,
  backend?: BackendInvoker,
): Promise<TargetsValidateResult> => callBackend("targets.validate", draft, backend);
export const getTargetDraft = (
  projectId: string,
  backend?: BackendInvoker,
): Promise<TargetDraftView | null> => callBackend("targets.draft.get", { projectId }, backend);
export const saveTargetDraft = (
  draft: TargetDraft,
  backend?: BackendInvoker,
): Promise<TargetDraftView> => callBackend("targets.draft.save", draft, backend);
export const startTargetDraft = (
  projectId: string,
  operationId?: string,
  backend?: BackendInvoker,
): Promise<SynthesisStartResult> =>
  callBackend(
    "targets.draft.start",
    { projectId, ...(operationId === undefined ? {} : { operationId }) },
    backend,
  );

export const startSynthesis = (
  params: SynthesisStartParams,
  backend?: BackendInvoker,
): Promise<SynthesisStartResult> => callBackend("synthesis.start", params, backend);
export const resolveSynthesisEditPlan = (
  planId: string,
  choice: "append_only" | "replacement",
  backend?: BackendInvoker,
): Promise<SynthesisSuccessResult> =>
  callBackend("synthesis.resolveEditPlan", { planId, choice }, backend);
export const cancelSynthesis = (
  operationId: string,
  backend?: BackendInvoker,
): Promise<{ ok: true }> => callBackend("synthesis.cancel", { operationId }, backend);
export const listRuns = (projectId: string, backend?: BackendInvoker): Promise<RunSummary[]> =>
  callBackend("runs.list", { projectId }, backend);
export const getRun = (runId: string, backend?: BackendInvoker): Promise<RunsGetResult> =>
  callBackend("runs.get", { runId }, backend);
export const exportRun = (
  runId: string,
  format: RunExportFormat,
  backend?: BackendInvoker,
): Promise<RunsExportResult> => callBackend("runs.export", { runId, format }, backend);
