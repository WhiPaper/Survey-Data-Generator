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
  "LEGACY_COMPATIBILITY_REQUIRED",
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

export const LegacyCompatibilityReasonSchema = z.enum([
  "missing_project_timezone",
  "missing_semantic_override_snapshot",
]);
export type LegacyCompatibilityReason = z.infer<typeof LegacyCompatibilityReasonSchema>;

export const LegacyCompatibilityOutcomeSchema = z
  .object({
    kind: z.literal("legacy_compatibility_required"),
    runId: z.string().min(1),
    reason: LegacyCompatibilityReasonSchema,
    supportedSinceDatabaseSchemaVersion: z.union([z.literal(8), z.literal(9)]),
  })
  .strict();
export type LegacyCompatibilityOutcome = z.infer<typeof LegacyCompatibilityOutcomeSchema>;

export const GoogleAccountIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as GoogleAccountId);

export const GoogleAccountViewSchema = z
  .object({
    id: GoogleAccountIdSchema,
    email: z.string().email(),
    displayName: z.string().min(1).optional(),
    avatarUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"))
      .optional(),
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

export const SystemCheckpointParamsSchema = z.object({}).strict();
export type SystemCheckpointParams = z.infer<typeof SystemCheckpointParamsSchema>;

export const SystemCheckpointResultSchema = z.object({ ok: z.literal(true) }).strict();
export type SystemCheckpointResult = z.infer<typeof SystemCheckpointResultSchema>;

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

export const AuthDeleteAccountDataParamsSchema = z.object({ id: GoogleAccountIdSchema }).strict();
export type AuthDeleteAccountDataParams = z.infer<typeof AuthDeleteAccountDataParamsSchema>;

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
    timeZone: z.string().min(1).nullable(),
    currentSourceRevisionId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    responseCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
    profileCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectSummaryView = z.infer<typeof ProjectSummarySchema>;

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
const ConditionPredicateSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("option_selected"),
        questionId: z.string().min(1),
        optionKey: z.string().min(1),
      })
      .strict(),
    z.object({ kind: z.literal("answered"), questionId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("and"), conditions: z.array(ConditionPredicateSchema) }).strict(),
    z.object({ kind: z.literal("or"), conditions: z.array(ConditionPredicateSchema) }).strict(),
  ]),
);
const ConditionalOutcomeSchema = z.discriminatedUnion("kind", [
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
  z
    .object({
      kind: z.literal("text_cluster"),
      questionId: z.string().min(1),
      clusterId: z.string().min(1),
      label: z.string().min(1),
      memberTexts: z.array(z.string()).readonly(),
      target: TargetValueSchema,
    })
    .strict(),
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
        z
          .object({
            kind: z.literal("selection_count_mean"),
            questionId: z.string().min(1),
            target: z.object({ kind: z.literal("mean"), value: z.number().finite() }).strict(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("text_cluster"),
            questionId: z.string().min(1),
            clusterId: z.string().min(1),
            label: z.string().min(1),
            memberTexts: z.array(z.string()).readonly(),
            target: TargetValueSchema,
          })
          .strict(),
      ]),
    ),
    detailedGoals: z
      .array(
        z
          .object({
            id: z.string().min(1),
            condition: ConditionPredicateSchema,
            outcome: ConditionalOutcomeSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const TargetMigrationIssueSchema = z
  .object({
    id: z.string().min(1),
    code: z.enum([
      "question_deleted",
      "question_type_changed",
      "option_removed",
      "option_ambiguous",
      "semantic_incompatible",
      "form_logic_changed",
      "group_changed",
      "unsupported",
    ]),
    message: z.string().min(1),
    questionId: z.string().min(1).optional(),
    optionKey: z.string().min(1).optional(),
    severity: z.enum(["warning", "blocking"]),
    originalTarget: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type TargetMigrationIssueView = z.infer<typeof TargetMigrationIssueSchema>;

export const TargetsGetParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const TargetsGetResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    targets: ProjectTargetsSchema,
    issues: z.array(TargetMigrationIssueSchema).optional(),
  })
  .strict();
export const TargetsUpdateParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    targets: ProjectTargetsSchema,
  })
  .strict();
export type TargetsUpdateParams = z.infer<typeof TargetsUpdateParamsSchema>;
export type TargetsGetResult = z.infer<typeof TargetsGetResultSchema>;
export const TargetsCheckFeasibilityParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    targets: ProjectTargetsSchema,
  })
  .strict();
export const TargetsCheckFeasibilityResultSchema = z
  .object({
    status: z.enum(["feasible", "infeasible", "unknown"]),
    issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  })
  .strict();
export type TargetsCheckFeasibilityResult = z.infer<typeof TargetsCheckFeasibilityResultSchema>;
export const AiMetadataSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.number().int().positive(),
    settingsHash: z.string().min(1),
    status: z.enum(["completed", "partial", "failed"]),
    itemCount: z.number().int().nonnegative(),
    generatedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    generatedAt: z.string().min(1),
    warnings: z.array(z.string()).optional(),
  })
  .strict();
export type AiMetadata = z.infer<typeof AiMetadataSchema>;

export const RunsGetParamsSchema = z.object({ runId: z.string().min(1) }).strict();
export const RunsGetResultSchema = z
  .object({
    runId: z.string().min(1),
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    targetSnapshot: ProjectTargetsSchema,
    targetRevision: z.number().int().nonnegative(),
    validation: z.record(z.string(), z.unknown()),
    finalResponseCount: z.number().int().nonnegative(),
    aiMetadata: AiMetadataSchema.optional(),
  })
  .strict();
export type RunsGetResult = z.infer<typeof RunsGetResultSchema>;

export const RunExportFormatSchema = z.enum(["csv", "xlsx"]);
export type RunExportFormat = z.infer<typeof RunExportFormatSchema>;

export const RunsExportParamsSchema = z
  .object({
    runId: z.string().min(1),
    format: RunExportFormatSchema,
  })
  .strict();
export type RunsExportParams = z.infer<typeof RunsExportParamsSchema>;

export const RunsExportResultSchema = z
  .object({
    ok: z.literal(true),
    cancelled: z.boolean(),
    destination: z.string().optional(),
    rowCount: z.number().int().nonnegative().optional(),
    columnCount: z.number().int().nonnegative().optional(),
    bytesWritten: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RunsExportResult = z.infer<typeof RunsExportResultSchema>;

export const AiStatusParamsSchema = z.object({}).strict();
export const AiStatusResultSchema = z
  .object({
    enabled: z.boolean(),
    configured: z.boolean(),
    disclosed: z.boolean(),
    provider: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();
export type AiStatusParams = z.infer<typeof AiStatusParamsSchema>;
export type AiStatusResult = z.infer<typeof AiStatusResultSchema>;

export const AiConfigureParamsSchema = z
  .object({
    apiKey: z.string().min(1),
  })
  .strict();
export type AiConfigureParams = z.infer<typeof AiConfigureParamsSchema>;

export const AiClearCredentialsParamsSchema = z.object({}).strict();
export type AiClearCredentialsParams = z.infer<typeof AiClearCredentialsParamsSchema>;

export const AiAcknowledgeDisclosureParamsSchema = z.object({}).strict();
export type AiAcknowledgeDisclosureParams = z.infer<typeof AiAcknowledgeDisclosureParamsSchema>;

export const AiGenerateParamsSchema = z
  .object({
    runId: z.string().min(1),
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AiGenerateParams = z.infer<typeof AiGenerateParamsSchema>;

export const AiGenerateResultSchema = z
  .object({
    status: z.enum(["completed", "partial", "skipped"]),
    runId: z.string().min(1),
    generatedFieldCount: z.number().int().nonnegative(),
    totalEligibleFieldCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    metadata: AiMetadataSchema.optional(),
  })
  .strict();
export type AiGenerateResult = z.infer<typeof AiGenerateResultSchema>;

export const AiCancelParamsSchema = z
  .object({
    operationId: z.string().min(1).max(200),
  })
  .strict();
export type AiCancelParams = z.infer<typeof AiCancelParamsSchema>;

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  form: z.record(z.string(), z.unknown()),
  responseTimestampRange: z
    .object({ start: z.string().min(1), end: z.string().min(1) })
    .nullable()
    .optional(),
  targets: ProjectTargetsSchema,
  targetRevision: z.number().int().nonnegative(),
  profiles: z.array(z.record(z.string(), z.unknown())),
  relationships: z.array(z.record(z.string(), z.unknown())),
  migrationIssues: z.array(TargetMigrationIssueSchema).optional(),
}).strict();
export type ProjectDetailView = z.infer<typeof ProjectDetailSchema>;
export const TimestampRangeSchema = z
  .object({ start: z.string().min(1), end: z.string().min(1) })
  .strict();
export type TimestampRange = z.infer<typeof TimestampRangeSchema>;
export const ProjectsListParamsSchema = z.object({}).strict();
export const ProjectsGetParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const ProjectsDeleteParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const ProjectsTimelineParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    start: z.string().min(1),
    end: z.string().min(1),
    bucketCount: z.number().int().min(8).max(240),
    targetCount: z.number().int().nonnegative().optional(),
    seed: z.number().int().optional(),
  })
  .strict();
export const ProjectTimelineSchema = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
    timeZone: z.string().min(1),
    buckets: z.array(
      z
        .object({
          start: z.string().min(1),
          end: z.string().min(1),
          label: z.string().min(1),
          originalCount: z.number().int().nonnegative(),
          syntheticCount: z.number().int().nonnegative().optional(),
        })
        .strict(),
    ),
    totalOriginalCount: z.number().int().nonnegative(),
    sourceTotalCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectsTimelineParams = z.infer<typeof ProjectsTimelineParamsSchema>;
export type ProjectTimeline = z.infer<typeof ProjectTimelineSchema>;

export const ProjectsRefreshSourceParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    expectedTargetRevision: z.number().int().nonnegative(),
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ProjectsRefreshSourceParams = z.infer<typeof ProjectsRefreshSourceParamsSchema>;

export const ProjectsRefreshSourceCancelParamsSchema = z
  .object({
    operationId: z.string().min(1).max(200),
  })
  .strict();
export type ProjectsRefreshSourceCancelParams = z.infer<
  typeof ProjectsRefreshSourceCancelParamsSchema
>;

export const ProjectsRefreshSourceResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("no_change"),
      sourceRevisionId: z.string().min(1),
      sourceResponseCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("updated"),
      sourceRevisionId: z.string().min(1),
      sourceResponseCount: z.number().int().nonnegative(),
      addedResponseCount: z.number().int().nonnegative(),
      changedResponseCount: z.number().int().nonnegative(),
      removedResponseCount: z.number().int().nonnegative(),
      targetRevision: z.number().int().nonnegative(),
      schemaSeverity: z.enum(["none", "compatible", "breaking"]),
      issues: z.array(TargetMigrationIssueSchema),
    })
    .strict(),
]);
export type ProjectsRefreshSourceResult = z.infer<typeof ProjectsRefreshSourceResultSchema>;

export const ProjectsResolveMigrationIssueParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    issueId: z.string().min(1),
    resolution: z.enum(["acknowledge", "remove_target"]).optional(),
  })
  .strict();
export type ProjectsResolveMigrationIssueParams = z.infer<
  typeof ProjectsResolveMigrationIssueParamsSchema
>;

export const SynthesisStartParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    targets: ProjectTargetsSchema,
    timestampRange: TimestampRangeSchema.optional(),
    targetRevision: z.number().int().nonnegative().optional(),
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
  "host.dialog.save",
]);
export type HostCapabilityMethod = z.infer<typeof HostCapabilityMethodSchema>;

export const HostSecretGetResultSchema = z.object({ value: z.string().nullable() }).strict();
export type HostSecretGetResult = z.infer<typeof HostSecretGetResultSchema>;

export const HostDialogSaveResultSchema = z.object({ path: z.string().min(1).nullable() }).strict();
export type HostDialogSaveResult = z.infer<typeof HostDialogSaveResultSchema>;

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
  "system.checkpoint": {
    input: SystemCheckpointParams;
    output: SystemCheckpointResult;
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
  "auth.deleteAccountData": {
    input: AuthDeleteAccountDataParams;
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
  "projects.timeline": {
    input: ProjectsTimelineParams;
    output: ProjectTimeline;
  };
  "projects.delete": {
    input: z.infer<typeof ProjectsDeleteParamsSchema>;
    output: AuthActionResult;
  };
  "projects.refreshSource": {
    input: ProjectsRefreshSourceParams;
    output: ProjectsRefreshSourceResult;
  };
  "projects.refreshSource.cancel": {
    input: ProjectsRefreshSourceCancelParams;
    output: AuthActionResult;
  };
  "projects.resolveMigrationIssue": {
    input: ProjectsResolveMigrationIssueParams;
    output: AuthActionResult;
  };
  "targets.get": { input: z.infer<typeof TargetsGetParamsSchema>; output: TargetsGetResult };
  "targets.update": { input: TargetsUpdateParams; output: TargetsGetResult };
  "targets.checkFeasibility": {
    input: z.infer<typeof TargetsCheckFeasibilityParamsSchema>;
    output: TargetsCheckFeasibilityResult;
  };
  "runs.get": { input: z.infer<typeof RunsGetParamsSchema>; output: RunsGetResult };
  "synthesis.start": {
    input: SynthesisStartParams;
    output: SynthesisStartResult;
  };
  "synthesis.cancel": {
    input: z.infer<typeof SynthesisCancelParamsSchema>;
    output: AuthActionResult;
  };
  "runs.export": {
    input: RunsExportParams;
    output: RunsExportResult;
  };
  "ai.status": {
    input: AiStatusParams;
    output: AiStatusResult;
  };
  "ai.configure": {
    input: AiConfigureParams;
    output: AuthActionResult;
  };
  "ai.clearCredentials": {
    input: AiClearCredentialsParams;
    output: AuthActionResult;
  };
  "ai.acknowledgeDisclosure": {
    input: AiAcknowledgeDisclosureParams;
    output: AuthActionResult;
  };
  "ai.generate": {
    input: AiGenerateParams;
    output: AiGenerateResult;
  };
  "ai.cancel": {
    input: AiCancelParams;
    output: AuthActionResult;
  };
}

export type RpcMethod = keyof BackendRpc;

const rpcResultSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "system.ping": SystemPingResultSchema,
  "system.shutdown": SystemShutdownResultSchema,
  "system.checkpoint": SystemCheckpointResultSchema,
  "session.get": SessionViewSchema.nullable(),
  "auth.login": SessionViewSchema,
  "auth.accounts": z.array(GoogleAccountViewSchema),
  "auth.addAccount": SessionViewSchema,
  "auth.switchAccount": SessionViewSchema,
  "auth.logout": AuthActionResultSchema,
  "auth.revokeAccess": AuthActionResultSchema,
  "auth.deleteAccountData": AuthActionResultSchema,
  "forms.list": FormsListResultSchema,
  "forms.import": FormImportSummarySchema,
  "forms.import.cancel": AuthActionResultSchema,
  "projects.list": z.array(ProjectSummarySchema),
  "projects.get": ProjectDetailSchema.nullable(),
  "projects.timeline": ProjectTimelineSchema,
  "projects.delete": AuthActionResultSchema,
  "projects.refreshSource": ProjectsRefreshSourceResultSchema,
  "projects.refreshSource.cancel": AuthActionResultSchema,
  "projects.resolveMigrationIssue": AuthActionResultSchema,
  "targets.get": TargetsGetResultSchema,
  "targets.update": TargetsGetResultSchema,
  "targets.checkFeasibility": TargetsCheckFeasibilityResultSchema,
  "runs.get": RunsGetResultSchema,
  "synthesis.start": SynthesisStartResultSchema,
  "synthesis.cancel": AuthActionResultSchema,
  "runs.export": RunsExportResultSchema,
  "ai.status": AiStatusResultSchema,
  "ai.configure": AuthActionResultSchema,
  "ai.clearCredentials": AuthActionResultSchema,
  "ai.acknowledgeDisclosure": AuthActionResultSchema,
  "ai.generate": AiGenerateResultSchema,
  "ai.cancel": AuthActionResultSchema,
};

const parseKnownParams = (method: string, params: unknown): void => {
  if (method === "system.ping") {
    SystemPingParamsSchema.parse(params);
  } else if (method === "system.shutdown") {
    SystemShutdownParamsSchema.parse(params);
  } else if (method === "system.checkpoint") {
    SystemCheckpointParamsSchema.parse(params);
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
  } else if (method === "auth.deleteAccountData") {
    AuthDeleteAccountDataParamsSchema.parse(params);
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
  } else if (method === "projects.timeline") {
    ProjectsTimelineParamsSchema.parse(params);
  } else if (method === "projects.delete") {
    ProjectsDeleteParamsSchema.parse(params);
  } else if (method === "projects.refreshSource") {
    ProjectsRefreshSourceParamsSchema.parse(params);
  } else if (method === "projects.refreshSource.cancel") {
    ProjectsRefreshSourceCancelParamsSchema.parse(params);
  } else if (method === "projects.resolveMigrationIssue") {
    ProjectsResolveMigrationIssueParamsSchema.parse(params);
  } else if (method === "targets.get") {
    TargetsGetParamsSchema.parse(params);
  } else if (method === "targets.update") {
    TargetsUpdateParamsSchema.parse(params);
  } else if (method === "targets.checkFeasibility") {
    TargetsCheckFeasibilityParamsSchema.parse(params);
  } else if (method === "runs.get") {
    RunsGetParamsSchema.parse(params);
  } else if (method === "synthesis.start") {
    SynthesisStartParamsSchema.parse(params);
  } else if (method === "synthesis.cancel") {
    SynthesisCancelParamsSchema.parse(params);
  } else if (method === "runs.export") {
    RunsExportParamsSchema.parse(params);
  } else if (method === "ai.status") {
    AiStatusParamsSchema.parse(params);
  } else if (method === "ai.configure") {
    AiConfigureParamsSchema.parse(params);
  } else if (method === "ai.clearCredentials") {
    AiClearCredentialsParamsSchema.parse(params);
  } else if (method === "ai.acknowledgeDisclosure") {
    AiAcknowledgeDisclosureParamsSchema.parse(params);
  } else if (method === "ai.generate") {
    AiGenerateParamsSchema.parse(params);
  } else if (method === "ai.cancel") {
    AiCancelParamsSchema.parse(params);
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
