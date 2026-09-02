import { z } from "zod";

import type { FormId, GoogleAccountId } from "@survey-synth/domain";

export type { FormId, GoogleAccountId } from "@survey-synth/domain";

import { VERSIONS } from "./version.js";

export const BackendErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "REAUTH_REQUIRED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "TARGET_CONFLICT",
  "GOOGLE_API_ERROR",
  "RATE_LIMITED",
  "JOB_CANCELLED",
  "BACKEND_UNAVAILABLE",
  "INTERNAL",
]);

export type BackendErrorCode = z.infer<typeof BackendErrorCodeSchema>;

export const BackendErrorSchema = z
  .object({
    code: BackendErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    recoverable: z.boolean(),
  })
  .strict();

export type BackendError = z.infer<typeof BackendErrorSchema>;

export const GoogleAccountIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as GoogleAccountId);

export const GoogleAccountViewSchema = z
  .object({
    id: GoogleAccountIdSchema,
    email: z.string().email(),
    displayName: z.string().min(1).optional(),
  })
  .strict();

export type GoogleAccountView = z.infer<typeof GoogleAccountViewSchema>;

export const SessionViewSchema = z
  .object({
    account: GoogleAccountViewSchema,
  })
  .strict();

export type SessionView = z.infer<typeof SessionViewSchema>;

export const RequestEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("request"),
    id: z.string().min(1),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

export const SuccessResponseEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("response"),
    id: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict();

export const ErrorResponseEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("response"),
    id: z.string().min(1),
    ok: z.literal(false),
    error: BackendErrorSchema,
  })
  .strict();

export const ResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  SuccessResponseEnvelopeSchema,
  ErrorResponseEnvelopeSchema,
]);

export type SuccessResponseEnvelope = z.infer<typeof SuccessResponseEnvelopeSchema>;
export type ErrorResponseEnvelope = z.infer<typeof ErrorResponseEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;

export const SidecarReadySchema = z
  .object({
    type: z.literal("ready"),
    appVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
    databaseSchemaVersion: z.number().int().nonnegative(),
    domainSchemaVersion: z.number().int().nonnegative(),
    engineVersion: z.number().int().nonnegative(),
    profilerVersion: z.number().int().nonnegative(),
  })
  .strict();

export type SidecarReady = z.infer<typeof SidecarReadySchema>;

export const SystemPingParamsSchema = z.object({}).strict();
export type SystemPingParams = z.infer<typeof SystemPingParamsSchema>;

export const SystemPingResultSchema = z
  .object({
    ok: z.literal(true),
    message: z.literal("pong"),
  })
  .strict();

export type SystemPingResult = z.infer<typeof SystemPingResultSchema>;

export const SystemShutdownParamsSchema = z.object({}).strict();
export type SystemShutdownParams = z.infer<typeof SystemShutdownParamsSchema>;

export const SystemShutdownResultSchema = z
  .object({
    ok: z.literal(true),
    message: z.literal("shutting_down"),
  })
  .strict();

export type SystemShutdownResult = z.infer<typeof SystemShutdownResultSchema>;

export const AuthActionResultSchema = z.object({ ok: z.literal(true) }).strict();
export type AuthActionResult = z.infer<typeof AuthActionResultSchema>;

export const SessionGetParamsSchema = z.object({}).strict();
export type SessionGetParams = z.infer<typeof SessionGetParamsSchema>;

export const AuthLoginParamsSchema = z.object({}).strict();
export type AuthLoginParams = z.infer<typeof AuthLoginParamsSchema>;

export const AuthAccountsParamsSchema = z.object({}).strict();
export type AuthAccountsParams = z.infer<typeof AuthAccountsParamsSchema>;

export const AuthAddAccountParamsSchema = z.object({}).strict();
export type AuthAddAccountParams = z.infer<typeof AuthAddAccountParamsSchema>;

export const AuthSwitchAccountParamsSchema = z.object({ id: GoogleAccountIdSchema }).strict();
export type AuthSwitchAccountParams = z.infer<typeof AuthSwitchAccountParamsSchema>;

export const AuthLogoutParamsSchema = z.object({}).strict();
export type AuthLogoutParams = z.infer<typeof AuthLogoutParamsSchema>;

export const AuthRevokeAccessParamsSchema = z.object({ id: GoogleAccountIdSchema }).strict();
export type AuthRevokeAccessParams = z.infer<typeof AuthRevokeAccessParamsSchema>;

export const FormIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as FormId);

export const FormListItemSchema = z
  .object({
    formId: FormIdSchema,
    title: z.string().min(1),
    modifiedAt: z.string().min(1).optional(),
  })
  .strict();

export type FormListItem = z.infer<typeof FormListItemSchema>;

export const FormsListParamsSchema = z
  .object({
    query: z.string().max(200).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export type FormsListParams = z.infer<typeof FormsListParamsSchema>;

export const FormsListResultSchema = z
  .object({
    items: z.array(FormListItemSchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type FormsListResult = z.infer<typeof FormsListResultSchema>;

export const FormsImportParamsSchema = z
  .object({
    formId: FormIdSchema,
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type FormsImportParams = z.infer<typeof FormsImportParamsSchema>;

export const FormsImportCancelParamsSchema = z
  .object({ operationId: z.string().min(1).max(200) })
  .strict();
export type FormsImportCancelParams = z.infer<typeof FormsImportCancelParamsSchema>;

export const FormImportSummarySchema = z
  .object({
    importId: z.string().min(1),
    formId: FormIdSchema,
    title: z.string().min(1),
    responseCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
    unsupportedQuestionCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FormImportSummary = z.infer<typeof FormImportSummarySchema>;

export const ProjectIdSchema = z.string().min(1);
export const ProjectSummarySchema = z
  .object({
    id: ProjectIdSchema,
    googleAccountId: GoogleAccountIdSchema,
    googleFormId: FormIdSchema,
    name: z.string().min(1),
    currentSourceRevisionId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    responseCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
    profileCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectSummaryView = z.infer<typeof ProjectSummarySchema>;
export const ProjectDetailSchema = ProjectSummarySchema.extend({
  profiles: z.array(z.record(z.string(), z.unknown())),
  relationships: z.array(z.record(z.string(), z.unknown())),
}).strict();
export type ProjectDetailView = z.infer<typeof ProjectDetailSchema>;
export const ProjectsListParamsSchema = z.object({}).strict();
export const ProjectsGetParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const ProjectsDeleteParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();

const TargetValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), value: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("ratio"), value: z.number().min(0).max(1) }).strict(),
  z
    .object({
      kind: z.literal("count_range"),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ratio_range"),
      min: z.number().min(0).max(1),
      max: z.number().min(0).max(1),
    })
    .strict(),
  z.object({ kind: z.literal("mean"), value: z.number().finite() }).strict(),
]);
export const ProjectTargetsSchema = z
  .object({
    targetResponseCount: z.number().int().nonnegative(),
    questionTargets: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("option"),
            questionId: z.string().min(1),
            optionKey: z.string().min(1),
            target: TargetValueSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal("mean"),
            questionId: z.string().min(1),
            target: z.object({ kind: z.literal("mean"), value: z.number().finite() }).strict(),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export const SynthesisStartParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    targets: ProjectTargetsSchema,
    seed: z.number().int(),
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const SynthesisCancelParamsSchema = z
  .object({ operationId: z.string().min(1).max(200) })
  .strict();
export const SynthesisStartResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      runId: z.string().min(1),
      finalResponseCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("infeasible"),
      issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    })
    .strict(),
  z
    .object({
      status: z.literal("unsupported"),
      issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    })
    .strict(),
]);
export type SynthesisStartParams = z.infer<typeof SynthesisStartParamsSchema>;
export type SynthesisStartResult = z.infer<typeof SynthesisStartResultSchema>;

export const HostCapabilityMethodSchema = z.enum([
  "host.secret.get",
  "host.secret.set",
  "host.secret.delete",
  "host.open_external",
]);
export type HostCapabilityMethod = z.infer<typeof HostCapabilityMethodSchema>;

export const HostSecretGetResultSchema = z.object({ value: z.string().nullable() }).strict();
export type HostSecretGetResult = z.infer<typeof HostSecretGetResultSchema>;

export const HostMutationResultSchema = z.object({ ok: z.literal(true) }).strict();
export type HostMutationResult = z.infer<typeof HostMutationResultSchema>;

export const HostRequestSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("host_request"),
    id: z.string().min(1),
    method: HostCapabilityMethodSchema,
    params: z.unknown(),
  })
  .strict();
export type HostRequest = z.infer<typeof HostRequestSchema>;

export const HostSuccessResponseSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("host_response"),
    id: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict();

export const HostErrorResponseSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("host_response"),
    id: z.string().min(1),
    ok: z.literal(false),
    error: BackendErrorSchema,
  })
  .strict();

export const HostResponseSchema = z.discriminatedUnion("ok", [
  HostSuccessResponseSchema,
  HostErrorResponseSchema,
]);

export type HostResponse = z.infer<typeof HostResponseSchema>;

export interface BackendRpc {
  "system.ping": {
    input: SystemPingParams;
    output: SystemPingResult;
  };
  "system.shutdown": {
    input: SystemShutdownParams;
    output: SystemShutdownResult;
  };
  "session.get": {
    input: SessionGetParams;
    output: SessionView | null;
  };
  "auth.login": {
    input: AuthLoginParams;
    output: SessionView;
  };
  "auth.accounts": {
    input: AuthAccountsParams;
    output: GoogleAccountView[];
  };
  "auth.addAccount": {
    input: AuthAddAccountParams;
    output: SessionView;
  };
  "auth.switchAccount": {
    input: AuthSwitchAccountParams;
    output: SessionView;
  };
  "auth.logout": {
    input: AuthLogoutParams;
    output: AuthActionResult;
  };
  "auth.revokeAccess": {
    input: AuthRevokeAccessParams;
    output: AuthActionResult;
  };
  "forms.list": {
    input: FormsListParams;
    output: FormsListResult;
  };
  "forms.import": {
    input: FormsImportParams;
    output: FormImportSummary;
  };
  "forms.import.cancel": {
    input: FormsImportCancelParams;
    output: AuthActionResult;
  };
  "projects.list": {
    input: z.infer<typeof ProjectsListParamsSchema>;
    output: ProjectSummaryView[];
  };
  "projects.get": {
    input: z.infer<typeof ProjectsGetParamsSchema>;
    output: ProjectDetailView | null;
  };
  "projects.delete": {
    input: z.infer<typeof ProjectsDeleteParamsSchema>;
    output: AuthActionResult;
  };
  "synthesis.start": {
    input: SynthesisStartParams;
    output: SynthesisStartResult;
  };
  "synthesis.cancel": {
    input: z.infer<typeof SynthesisCancelParamsSchema>;
    output: AuthActionResult;
  };
}

export type RpcMethod = keyof BackendRpc;

const rpcResultSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "system.ping": SystemPingResultSchema,
  "system.shutdown": SystemShutdownResultSchema,
  "session.get": SessionViewSchema.nullable(),
  "auth.login": SessionViewSchema,
  "auth.accounts": z.array(GoogleAccountViewSchema),
  "auth.addAccount": SessionViewSchema,
  "auth.switchAccount": SessionViewSchema,
  "auth.logout": AuthActionResultSchema,
  "auth.revokeAccess": AuthActionResultSchema,
  "forms.list": FormsListResultSchema,
  "forms.import": FormImportSummarySchema,
  "forms.import.cancel": AuthActionResultSchema,
  "projects.list": z.array(ProjectSummarySchema),
  "projects.get": ProjectDetailSchema.nullable(),
  "projects.delete": AuthActionResultSchema,
  "synthesis.start": SynthesisStartResultSchema,
  "synthesis.cancel": AuthActionResultSchema,
};

const parseKnownParams = (method: string, params: unknown): void => {
  if (method === "system.ping") {
    SystemPingParamsSchema.parse(params);
  } else if (method === "system.shutdown") {
    SystemShutdownParamsSchema.parse(params);
  } else if (method === "session.get") {
    SessionGetParamsSchema.parse(params);
  } else if (method === "auth.login") {
    AuthLoginParamsSchema.parse(params);
  } else if (method === "auth.accounts") {
    AuthAccountsParamsSchema.parse(params);
  } else if (method === "auth.addAccount") {
    AuthAddAccountParamsSchema.parse(params);
  } else if (method === "auth.switchAccount") {
    AuthSwitchAccountParamsSchema.parse(params);
  } else if (method === "auth.logout") {
    AuthLogoutParamsSchema.parse(params);
  } else if (method === "auth.revokeAccess") {
    AuthRevokeAccessParamsSchema.parse(params);
  } else if (method === "forms.list") {
    FormsListParamsSchema.parse(params);
  } else if (method === "forms.import") {
    FormsImportParamsSchema.parse(params);
  } else if (method === "forms.import.cancel") {
    FormsImportCancelParamsSchema.parse(params);
  } else if (method === "projects.list") {
    ProjectsListParamsSchema.parse(params);
  } else if (method === "projects.get") {
    ProjectsGetParamsSchema.parse(params);
  } else if (method === "projects.delete") {
    ProjectsDeleteParamsSchema.parse(params);
  } else if (method === "synthesis.start") {
    SynthesisStartParamsSchema.parse(params);
  } else if (method === "synthesis.cancel") {
    SynthesisCancelParamsSchema.parse(params);
  }
};

export const parseRpcRequest = (input: unknown): RequestEnvelope => {
  const request = RequestEnvelopeSchema.parse(input);
  parseKnownParams(request.method, request.params);
  return request;
};

export const parseSidecarReady = (input: unknown): SidecarReady => SidecarReadySchema.parse(input);

export const assertCompatibleReady = (ready: SidecarReady): SidecarReady => {
  if (
    ready.appVersion !== VERSIONS.appVersion ||
    ready.protocolVersion !== VERSIONS.protocolVersion
  ) {
    throw new Error("Incompatible sidecar version or protocol");
  }
  return ready;
};

export const parseResponseEnvelope = (input: unknown): ResponseEnvelope =>
  ResponseEnvelopeSchema.parse(input);

export const parseRpcResult = <M extends RpcMethod>(
  method: M,
  input: unknown,
): BackendRpc[M]["output"] => {
  return rpcResultSchemas[method].parse(input) as BackendRpc[M]["output"];
};

export const createRequest = <M extends RpcMethod>(
  id: string,
  method: M,
  params: BackendRpc[M]["input"],
): RequestEnvelope => {
  const request = { v: VERSIONS.protocolVersion, type: "request", id, method, params };
  return parseRpcRequest(request);
};

export const createPingRequest = (id: string): RequestEnvelope =>
  createRequest(id, "system.ping", {});

export const createShutdownRequest = (id: string): RequestEnvelope =>
  createRequest(id, "system.shutdown", {});

export const createSuccessResponse = (id: string, result: unknown): SuccessResponseEnvelope =>
  SuccessResponseEnvelopeSchema.parse({
    v: VERSIONS.protocolVersion,
    type: "response",
    id,
    ok: true,
    result,
  });

export const createErrorResponse = (id: string, error: BackendError): ErrorResponseEnvelope =>
  ErrorResponseEnvelopeSchema.parse({
    v: VERSIONS.protocolVersion,
    type: "response",
    id,
    ok: false,
    error,
  });
