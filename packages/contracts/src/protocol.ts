import { z } from "zod";

import type { FormId, GoogleAccountId } from "@survey-synth/domain";
import { VERSIONS } from "./version.js";

export type { FormId, GoogleAccountId } from "@survey-synth/domain";

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
export const FormIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as FormId);

export const GoogleAccountViewSchema = z
  .object({
    id: GoogleAccountIdSchema,
    email: z.string().email(),
    displayName: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional(),
  })
  .strict();
export type GoogleAccountView = z.infer<typeof GoogleAccountViewSchema>;

export const SessionViewSchema = z.object({ account: GoogleAccountViewSchema }).strict();
export type SessionView = z.infer<typeof SessionViewSchema>;

export const ActionResultSchema = z.object({ ok: z.literal(true) }).strict();
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const SystemPingResultSchema = z
  .object({ ok: z.literal(true), message: z.literal("pong") })
  .strict();
export type SystemPingResult = z.infer<typeof SystemPingResultSchema>;

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
    projectId: z.string().min(1),
    sourceRevisionId: z.string().min(1),
    formId: FormIdSchema,
    title: z.string().min(1),
    responseCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
    unsupportedQuestionCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FormImportSummary = z.infer<typeof FormImportSummarySchema>;
export type FormImportResult = FormImportSummary;

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
  })
  .strict();
export type ProjectSummaryView = z.infer<typeof ProjectSummarySchema>;

export const TimestampRangeSchema = z
  .object({ start: z.string().min(1), end: z.string().min(1) })
  .strict();
export type TimestampRange = z.infer<typeof TimestampRangeSchema>;

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  form: z.record(z.string(), z.unknown()),
  responseTimestampRange: TimestampRangeSchema.nullable(),
}).strict();
export type ProjectDetailView = z.infer<typeof ProjectDetailSchema>;

export const SourceScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z
    .object({
      kind: z.literal("submitted_between"),
      start: z.string().min(1),
      end: z.string().min(1),
    })
    .strict(),
]);
export type SourceScope = z.infer<typeof SourceScopeSchema>;

export const ValueGroupSchema = z
  .object({
    id: z.string().min(1),
    projectId: ProjectIdSchema,
    questionId: z.string().min(1),
    name: z.string().min(1),
    members: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type ValueGroupView = z.infer<typeof ValueGroupSchema>;

export const ValueGroupObservedValueSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type ValueGroupObservedValue = z.infer<typeof ValueGroupObservedValueSchema>;

export const MeanTargetSchema = z
  .object({
    kind: z.literal("mean"),
    questionId: z.string().min(1),
    value: z.number().finite(),
  })
  .strict();
export type MeanTarget = z.infer<typeof MeanTargetSchema>;

export const ShareTargetSchema = z
  .object({
    kind: z.literal("share"),
    valueGroupId: z.string().min(1),
    value: z.number().min(0).max(1),
  })
  .strict();
export type ShareTarget = z.infer<typeof ShareTargetSchema>;

export const ConditionalShareTargetSchema = z
  .object({
    kind: z.literal("conditional_share"),
    valueGroupId: z.string().min(1),
    questionId: z.string().min(1),
    optionKey: z.string().min(1),
    value: z.number().min(0).max(1),
  })
  .strict();
export type ConditionalShareTarget = z.infer<typeof ConditionalShareTargetSchema>;

export const SynthesisTargetSchema = z.discriminatedUnion("kind", [
  MeanTargetSchema,
  ShareTargetSchema,
  ConditionalShareTargetSchema,
]);
export type SynthesisTarget = z.infer<typeof SynthesisTargetSchema>;

export const SynthesisStartParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    finalCount: z.number().int().positive(),
    targets: z.array(SynthesisTargetSchema).min(1),
    sourceScope: SourceScopeSchema.optional(),
    seed: z.number().int(),
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type SynthesisStartParams = z.infer<typeof SynthesisStartParamsSchema>;

export const SynthesisStartResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      runId: z.string().min(1),
      syntheticResponseCount: z.number().int().nonnegative(),
      finalResponseCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("infeasible"),
      issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    })
    .strict(),
]);
export type SynthesisStartResult = z.infer<typeof SynthesisStartResultSchema>;

export const FrozenValueGroupSchema = z
  .object({
    id: z.string().min(1),
    questionId: z.string().min(1),
    name: z.string().min(1),
    members: z.array(z.string().min(1)),
  })
  .strict();
export type FrozenValueGroup = z.infer<typeof FrozenValueGroupSchema>;

export const FrozenRunTargetSchema = z.discriminatedUnion("kind", [
  MeanTargetSchema,
  z
    .object({
      kind: z.literal("share"),
      value: z.number().min(0).max(1),
      valueGroup: FrozenValueGroupSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("conditional_share"),
      value: z.number().min(0).max(1),
      valueGroup: FrozenValueGroupSchema,
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
    })
    .strict(),
]);
export type FrozenRunTarget = z.infer<typeof FrozenRunTargetSchema>;

export const RunTargetSnapshotSchema = z
  .object({
    finalCount: z.number().int().positive(),
    sourceScope: SourceScopeSchema,
    targets: z.array(FrozenRunTargetSchema).min(1),
  })
  .strict();
export type RunTargetSnapshot = z.infer<typeof RunTargetSnapshotSchema>;

export const RunsGetResultSchema = z
  .object({
    runId: z.string().min(1),
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    targetSnapshot: RunTargetSnapshotSchema,
    validation: z.record(z.string(), z.unknown()),
    finalResponseCount: z.number().int().nonnegative(),
  })
  .strict();
export type RunsGetResult = z.infer<typeof RunsGetResultSchema>;

const EmptyParamsSchema = z.object({}).strict();
const AccountIdParamsSchema = z.object({ id: GoogleAccountIdSchema }).strict();
const ProjectParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
const RunParamsSchema = z.object({ runId: z.string().min(1) }).strict();
const SynthesisCancelParamsSchema = z
  .object({ operationId: z.string().min(1).max(200) })
  .strict();
const ValueGroupsListParamsSchema = ProjectParamsSchema;
const ValueGroupsValuesParamsSchema = z
  .object({ projectId: ProjectIdSchema, questionId: z.string().min(1) })
  .strict();
const ValueGroupsCreateParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    questionId: z.string().min(1),
    name: z.string().min(1).max(120),
    members: z.array(z.string().min(1)).min(1),
  })
  .strict();
const ValueGroupsDeleteParamsSchema = z.object({ valueGroupId: z.string().min(1) }).strict();

export interface BackendRpc {
  "system.ping": { input: z.infer<typeof EmptyParamsSchema>; output: SystemPingResult };
  "session.get": { input: z.infer<typeof EmptyParamsSchema>; output: SessionView | null };
  "auth.login": { input: z.infer<typeof EmptyParamsSchema>; output: SessionView };
  "auth.accounts": { input: z.infer<typeof EmptyParamsSchema>; output: GoogleAccountView[] };
  "auth.addAccount": { input: z.infer<typeof EmptyParamsSchema>; output: SessionView };
  "auth.switchAccount": { input: z.infer<typeof AccountIdParamsSchema>; output: SessionView };
  "auth.logout": { input: z.infer<typeof EmptyParamsSchema>; output: ActionResult };
  "auth.revokeAccess": { input: z.infer<typeof AccountIdParamsSchema>; output: ActionResult };
  "auth.deleteAccountData": { input: z.infer<typeof AccountIdParamsSchema>; output: ActionResult };
  "forms.list": { input: FormsListParams; output: FormsListResult };
  "forms.import": { input: FormsImportParams; output: FormImportSummary };
  "forms.import.cancel": { input: FormsImportCancelParams; output: ActionResult };
  "projects.list": { input: z.infer<typeof EmptyParamsSchema>; output: ProjectSummaryView[] };
  "projects.get": { input: z.infer<typeof ProjectParamsSchema>; output: ProjectDetailView | null };
  "projects.delete": { input: z.infer<typeof ProjectParamsSchema>; output: ActionResult };
  "valueGroups.list": { input: z.infer<typeof ValueGroupsListParamsSchema>; output: ValueGroupView[] };
  "valueGroups.values": {
    input: z.infer<typeof ValueGroupsValuesParamsSchema>;
    output: ValueGroupObservedValue[];
  };
  "valueGroups.create": {
    input: z.infer<typeof ValueGroupsCreateParamsSchema>;
    output: ValueGroupView;
  };
  "valueGroups.delete": { input: z.infer<typeof ValueGroupsDeleteParamsSchema>; output: ActionResult };
  "synthesis.start": { input: SynthesisStartParams; output: SynthesisStartResult };
  "synthesis.cancel": { input: z.infer<typeof SynthesisCancelParamsSchema>; output: ActionResult };
  "runs.get": { input: z.infer<typeof RunParamsSchema>; output: RunsGetResult };
}

export type RpcMethod = keyof BackendRpc;

const rpcMethods = [
  "system.ping",
  "session.get",
  "auth.login",
  "auth.accounts",
  "auth.addAccount",
  "auth.switchAccount",
  "auth.logout",
  "auth.revokeAccess",
  "auth.deleteAccountData",
  "forms.list",
  "forms.import",
  "forms.import.cancel",
  "projects.list",
  "projects.get",
  "projects.delete",
  "valueGroups.list",
  "valueGroups.values",
  "valueGroups.create",
  "valueGroups.delete",
  "synthesis.start",
  "synthesis.cancel",
  "runs.get",
] as const satisfies readonly RpcMethod[];

const RpcMethodSchema = z.enum(rpcMethods);

export const RequestEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("request"),
    id: z.string().min(1),
    method: RpcMethodSchema,
    params: z.unknown(),
  })
  .strict();
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

const rpcParamSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "system.ping": EmptyParamsSchema,
  "session.get": EmptyParamsSchema,
  "auth.login": EmptyParamsSchema,
  "auth.accounts": EmptyParamsSchema,
  "auth.addAccount": EmptyParamsSchema,
  "auth.switchAccount": AccountIdParamsSchema,
  "auth.logout": EmptyParamsSchema,
  "auth.revokeAccess": AccountIdParamsSchema,
  "auth.deleteAccountData": AccountIdParamsSchema,
  "forms.list": FormsListParamsSchema,
  "forms.import": FormsImportParamsSchema,
  "forms.import.cancel": FormsImportCancelParamsSchema,
  "projects.list": EmptyParamsSchema,
  "projects.get": ProjectParamsSchema,
  "projects.delete": ProjectParamsSchema,
  "valueGroups.list": ValueGroupsListParamsSchema,
  "valueGroups.values": ValueGroupsValuesParamsSchema,
  "valueGroups.create": ValueGroupsCreateParamsSchema,
  "valueGroups.delete": ValueGroupsDeleteParamsSchema,
  "synthesis.start": SynthesisStartParamsSchema,
  "synthesis.cancel": SynthesisCancelParamsSchema,
  "runs.get": RunParamsSchema,
};

const rpcResultSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "system.ping": SystemPingResultSchema,
  "session.get": SessionViewSchema.nullable(),
  "auth.login": SessionViewSchema,
  "auth.accounts": z.array(GoogleAccountViewSchema),
  "auth.addAccount": SessionViewSchema,
  "auth.switchAccount": SessionViewSchema,
  "auth.logout": ActionResultSchema,
  "auth.revokeAccess": ActionResultSchema,
  "auth.deleteAccountData": ActionResultSchema,
  "forms.list": FormsListResultSchema,
  "forms.import": FormImportSummarySchema,
  "forms.import.cancel": ActionResultSchema,
  "projects.list": z.array(ProjectSummarySchema),
  "projects.get": ProjectDetailSchema.nullable(),
  "projects.delete": ActionResultSchema,
  "valueGroups.list": z.array(ValueGroupSchema),
  "valueGroups.values": z.array(ValueGroupObservedValueSchema),
  "valueGroups.create": ValueGroupSchema,
  "valueGroups.delete": ActionResultSchema,
  "synthesis.start": SynthesisStartResultSchema,
  "synthesis.cancel": ActionResultSchema,
  "runs.get": RunsGetResultSchema,
};

export const parseRpcRequest = (input: unknown): RequestEnvelope => {
  const request = RequestEnvelopeSchema.parse(input);
  rpcParamSchemas[request.method].parse(request.params);
  return request;
};

export const parseRpcResult = <M extends RpcMethod>(
  method: M,
  input: unknown,
): BackendRpc[M]["output"] =>
  rpcResultSchemas[method].parse(input) as BackendRpc[M]["output"];

export const createRequest = <M extends RpcMethod>(
  id: string,
  method: M,
  params: BackendRpc[M]["input"],
): RequestEnvelope =>
  parseRpcRequest({
    v: VERSIONS.protocolVersion,
    type: "request",
    id,
    method,
    params,
  });

export const createPingRequest = (id: string): RequestEnvelope =>
  createRequest(id, "system.ping", {});
