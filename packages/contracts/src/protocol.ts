import { z } from "zod";

import type { FormId, GoogleAccountId, TargetId } from "@survey-synth/domain";
import { VERSIONS } from "./version.js";

export type { FormId, GoogleAccountId, TargetId } from "@survey-synth/domain";

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
export const TargetIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as TargetId);

export const GoogleAccountViewSchema = z
  .object({
    id: GoogleAccountIdSchema,
    email: z.string().email(),
    displayName: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional(),
  })
  .strict();
export type GoogleAccountView = z.infer<typeof GoogleAccountViewSchema>;
export const GoogleAccountListItemSchema = GoogleAccountViewSchema.extend({
  connected: z.boolean(),
}).strict();
export type GoogleAccountListItem = z.infer<typeof GoogleAccountListItemSchema>;

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
    projectName: z.string().trim().min(1).max(120).optional(),
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

export const ProjectSourceRefreshParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ProjectSourceRefreshParams = z.infer<typeof ProjectSourceRefreshParamsSchema>;

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

export const TargetSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("option"),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkbox_option"),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("value_group"), valueGroupId: z.string().min(1) }).strict(),
]);
export type TargetSubject = z.infer<typeof TargetSubjectSchema>;

export const CountTargetSchema = z
  .object({
    id: TargetIdSchema,
    kind: z.literal("count"),
    subject: TargetSubjectSchema,
    value: z.number().int().nonnegative(),
  })
  .strict();
export type CountTarget = z.infer<typeof CountTargetSchema>;

export const ShareTargetSchema = z
  .object({
    id: TargetIdSchema,
    kind: z.literal("share"),
    subject: TargetSubjectSchema,
    value: z.number().min(0).max(1),
  })
  .strict();
export type ShareTarget = z.infer<typeof ShareTargetSchema>;

export const MeanTargetSchema = z
  .object({
    id: TargetIdSchema,
    kind: z.literal("mean"),
    questionId: z.string().min(1),
    value: z.number().finite(),
  })
  .strict();
export type MeanTarget = z.infer<typeof MeanTargetSchema>;

export const ConditionalShareTargetSchema = z
  .object({
    id: TargetIdSchema,
    kind: z.literal("conditional_share"),
    population: z
      .object({ kind: z.literal("value_group"), valueGroupId: z.string().min(1) })
      .strict(),
    questionId: z.string().min(1),
    optionKey: z.string().min(1),
    value: z.number().min(0).max(1),
  })
  .strict();
export type ConditionalShareTarget = z.infer<typeof ConditionalShareTargetSchema>;

export const SynthesisTargetSchema = z.discriminatedUnion("kind", [
  CountTargetSchema,
  ShareTargetSchema,
  MeanTargetSchema,
  ConditionalShareTargetSchema,
]);
export type SynthesisTarget = z.infer<typeof SynthesisTargetSchema>;

export const TargetIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absolute"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("percentage_point_delta"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("relative_percent_delta"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("count_delta"), value: z.number().int() }).strict(),
]);
export type TargetIntent = z.infer<typeof TargetIntentSchema>;

const DraftIntentSchema = TargetIntentSchema.nullable();
export const TargetDraftTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("count"),
      subject: TargetSubjectSchema,
      intent: DraftIntentSchema,
    })
    .strict(),
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("share"),
      subject: TargetSubjectSchema,
      intent: DraftIntentSchema,
    })
    .strict(),
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("mean"),
      questionId: z.string().min(1),
      intent: DraftIntentSchema,
    })
    .strict(),
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("conditional_share"),
      population: z
        .object({ kind: z.literal("value_group"), valueGroupId: z.string().min(1) })
        .strict(),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
      intent: DraftIntentSchema,
    })
    .strict(),
]);
export type TargetDraftTarget = z.infer<typeof TargetDraftTargetSchema>;

export const TargetDraftSchema = z
  .object({
    projectId: ProjectIdSchema,
    finalCount: z.number().int().positive().nullable(),
    sourceScope: SourceScopeSchema,
    seed: z.number().int(),
    targets: z.array(TargetDraftTargetSchema),
  })
  .strict();
export type TargetDraft = z.infer<typeof TargetDraftSchema>;
export const TargetDraftViewSchema = TargetDraftSchema.extend({
  updatedAt: z.string().min(1),
}).strict();
export type TargetDraftView = z.infer<typeof TargetDraftViewSchema>;

export const TargetProfileMetricSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("subject"),
      subject: TargetSubjectSchema,
      count: z.number().int().nonnegative(),
      denominatorCount: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mean"),
      questionId: z.string().min(1),
      mean: z.number().finite(),
      denominatorCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ordinal_distribution"),
      questionId: z.string().min(1),
      denominatorCount: z.number().int().nonnegative(),
      values: z.array(
        z
          .object({
            value: z.number().finite(),
            count: z.number().int().nonnegative(),
            share: z.number().min(0).max(1),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("conditional_share"),
      population: z
        .object({ kind: z.literal("value_group"), valueGroupId: z.string().min(1) })
        .strict(),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
      count: z.number().int().nonnegative(),
      denominatorCount: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    })
    .strict(),
]);
export type TargetProfileMetric = z.infer<typeof TargetProfileMetricSchema>;
export const TargetProfileResultSchema = z
  .object({
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    sourceScope: SourceScopeSchema,
    responseCount: z.number().int().nonnegative(),
    responseSetHash: z.string().min(1),
    metrics: z.array(TargetProfileMetricSchema),
  })
  .strict();
export type TargetProfileResult = z.infer<typeof TargetProfileResultSchema>;

export const SynthesisTargetIntentSnapshotSchema = z
  .object({
    targetId: TargetIdSchema,
    intent: TargetIntentSchema,
  })
  .strict();
export type SynthesisTargetIntentSnapshot = z.infer<typeof SynthesisTargetIntentSnapshotSchema>;

export const SynthesisStartParamsSchema = z
  .object({
    projectId: ProjectIdSchema,
    finalCount: z.number().int().positive(),
    targets: z.array(SynthesisTargetSchema).min(1),
    targetIntents: z.array(SynthesisTargetIntentSnapshotSchema).optional(),
    sourceScope: SourceScopeSchema.optional(),
    seed: z.number().int(),
    operationId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const targetIds = new Set<string>();
    value.targets.forEach((target, index) => {
      const id = String(target.id);
      if (targetIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index, "id"],
          message: "TargetId must be unique within a Run",
        });
      }
      targetIds.add(id);
    });

    const intentIds = new Set<string>();
    value.targetIntents?.forEach((entry, index) => {
      const id = String(entry.targetId);
      if (intentIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetIntents", index, "targetId"],
          message: "Target intent metadata must be unique by TargetId",
        });
      }
      intentIds.add(id);

      const target = value.targets.find((candidate) => String(candidate.id) === id);
      if (!target) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetIntents", index, "targetId"],
          message: "Target intent metadata must reference a target in this Run",
        });
        return;
      }

      const intentKind = entry.intent.kind;
      const supported =
        target.kind === "count"
          ? intentKind === "absolute" || intentKind === "count_delta"
          : target.kind === "mean"
            ? intentKind === "absolute"
            : intentKind === "absolute" ||
              intentKind === "percentage_point_delta" ||
              intentKind === "relative_percent_delta";
      if (!supported) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetIntents", index, "intent", "kind"],
          message: "Target intent metadata is not valid for this target kind",
        });
      }
    });
  });
export type SynthesisStartParams = z.infer<typeof SynthesisStartParamsSchema>;

export const TargetOutcomeSchema = z
  .object({
    targetId: TargetIdSchema,
    kind: z.enum(["count", "share", "mean", "conditional_share"]),
    requested: z.number().finite(),
    achieved: z.number().finite(),
    absoluteError: z.number().nonnegative(),
    exact: z.boolean(),
    numeratorCount: z.number().int().nonnegative().optional(),
    denominatorCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TargetOutcome = z.infer<typeof TargetOutcomeSchema>;

export const TargetSetOutcomeSchema = z.object({ targets: z.array(TargetOutcomeSchema) }).strict();
export type TargetSetOutcome = z.infer<typeof TargetSetOutcomeSchema>;
export const EditPlanTargetOutcomeSchema = TargetSetOutcomeSchema;
export type EditPlanTargetOutcome = TargetSetOutcome;

export const ProposedReplacementSchema = z
  .object({
    sourceResponseId: z.string().min(1),
    replacementResponseId: z.string().min(1),
  })
  .strict();
export type ProposedReplacement = z.infer<typeof ProposedReplacementSchema>;

export const EditPlanPreviewSchema = z
  .object({
    status: z.literal("available"),
    replacementCount: z.number().int().positive(),
    proposedReplacements: z.array(ProposedReplacementSchema).min(1),
    appendOnlyOutcome: TargetSetOutcomeSchema,
    replacementOutcome: TargetSetOutcomeSchema,
  })
  .strict();
export type EditPlanPreview = z.infer<typeof EditPlanPreviewSchema>;

export const TargetIssueCodeSchema = z.enum([
  "out_of_range",
  "invalid_subject",
  "immutable_source_conflict",
  "zero_denominator",
  "target_conflict",
  "candidate_support",
  "domain_unsupported",
]);
export type TargetIssueCode = z.infer<typeof TargetIssueCodeSchema>;

export const TargetIssueSchema = z
  .object({
    targetIds: z.array(TargetIdSchema),
    code: TargetIssueCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export type TargetIssue = z.infer<typeof TargetIssueSchema>;
export const TargetsValidateResultSchema = z
  .object({ issues: z.array(TargetIssueSchema) })
  .strict();
export type TargetsValidateResult = z.infer<typeof TargetsValidateResultSchema>;

export const ProjectSourceRefreshResultSchema = z
  .object({
    project: ProjectDetailSchema,
    previousSourceRevisionId: z.string().min(1),
    sourceRevisionId: z.string().min(1),
    invalidValueGroupIds: z.array(z.string().min(1)),
    targetIssues: z.array(TargetIssueSchema),
  })
  .strict();
export type ProjectSourceRefreshResult = z.infer<typeof ProjectSourceRefreshResultSchema>;

export const ProjectSourceReviewResultSchema = z
  .object({
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    invalidValueGroupIds: z.array(z.string().min(1)),
    targetIssues: z.array(TargetIssueSchema),
  })
  .strict();
export type ProjectSourceReviewResult = z.infer<typeof ProjectSourceReviewResultSchema>;

export const SynthesisSuccessResultSchema = z
  .object({
    status: z.literal("success"),
    runId: z.string().min(1),
    syntheticResponseCount: z.number().int().nonnegative(),
    finalResponseCount: z.number().int().nonnegative(),
    outcome: TargetSetOutcomeSchema,
  })
  .strict();
export type SynthesisSuccessResult = z.infer<typeof SynthesisSuccessResultSchema>;

export const SynthesisStartResultSchema = z.discriminatedUnion("status", [
  SynthesisSuccessResultSchema,
  z
    .object({
      status: z.literal("approval_required"),
      planId: z.string().min(1),
      editPlan: EditPlanPreviewSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("infeasible"),
      issues: z.array(TargetIssueSchema),
    })
    .strict(),
]);
export type SynthesisStartResult = z.infer<typeof SynthesisStartResultSchema>;

export const SynthesisResolveEditPlanParamsSchema = z
  .object({
    planId: z.string().min(1),
    choice: z.enum(["append_only", "replacement"]),
  })
  .strict();
export type SynthesisResolveEditPlanParams = z.infer<typeof SynthesisResolveEditPlanParamsSchema>;

export const FrozenValueGroupSchema = z
  .object({
    id: z.string().min(1),
    questionId: z.string().min(1),
    name: z.string().min(1),
    members: z.array(z.string().min(1)),
  })
  .strict();
export type FrozenValueGroup = z.infer<typeof FrozenValueGroupSchema>;

export const FrozenTargetSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("option"),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkbox_option"),
      questionId: z.string().min(1),
      optionKey: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("value_group"), valueGroup: FrozenValueGroupSchema }).strict(),
]);
export type FrozenTargetSubject = z.infer<typeof FrozenTargetSubjectSchema>;

export const FrozenRunTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("count"),
      subject: FrozenTargetSubjectSchema,
      intent: TargetIntentSchema.optional(),
      value: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("share"),
      subject: FrozenTargetSubjectSchema,
      intent: TargetIntentSchema.optional(),
      value: z.number().min(0).max(1),
    })
    .strict(),
  MeanTargetSchema.extend({ intent: TargetIntentSchema.optional() }).strict(),
  z
    .object({
      id: TargetIdSchema,
      kind: z.literal("conditional_share"),
      value: z.number().min(0).max(1),
      intent: TargetIntentSchema.optional(),
      population: z
        .object({ kind: z.literal("value_group"), valueGroup: FrozenValueGroupSchema })
        .strict(),
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
    editPlan: EditPlanPreviewSchema.optional(),
  })
  .strict();
export type RunTargetSnapshot = z.infer<typeof RunTargetSnapshotSchema>;

export const RunTargetBaselineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      targetId: TargetIdSchema,
      kind: z.literal("count"),
      count: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      targetId: TargetIdSchema,
      kind: z.literal("share"),
      count: z.number().int().nonnegative(),
      denominatorCount: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      targetId: TargetIdSchema,
      kind: z.literal("mean"),
      mean: z.number().finite(),
      denominatorCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      targetId: TargetIdSchema,
      kind: z.literal("conditional_share"),
      count: z.number().int().nonnegative(),
      denominatorCount: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    })
    .strict(),
]);
export type RunTargetBaseline = z.infer<typeof RunTargetBaselineSchema>;

export const RunTargetPresentationSchema = z
  .object({
    targetId: TargetIdSchema,
    questionId: z.string().min(1),
    questionOrder: z.number().int().nonnegative(),
    questionTitle: z.string().min(1),
    subjectLabel: z.string().min(1),
    populationLabel: z.string().min(1).optional(),
  })
  .strict();
export type RunTargetPresentation = z.infer<typeof RunTargetPresentationSchema>;

export const RunResultDiagnosticsSchema = z
  .object({
    sourceResponseCount: z.number().int().nonnegative(),
    syntheticResponseCount: z.number().int().nonnegative(),
    replacementCount: z.number().int().nonnegative(),
    structuralValidation: z.enum(["passed", "unknown"]),
  })
  .strict();
export type RunResultDiagnostics = z.infer<typeof RunResultDiagnosticsSchema>;

export const RunsGetResultSchema = z
  .object({
    runId: z.string().min(1),
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    targetSnapshot: RunTargetSnapshotSchema,
    outcome: TargetSetOutcomeSchema,
    baselines: z.array(RunTargetBaselineSchema),
    presentations: z.array(RunTargetPresentationSchema),
    diagnostics: RunResultDiagnosticsSchema,
    validation: z.record(z.string(), z.unknown()),
    finalResponseCount: z.number().int().nonnegative(),
    appVersion: z.string().min(1),
    engineVersion: z.number().int().nonnegative(),
  })
  .strict();
export type RunsGetResult = z.infer<typeof RunsGetResultSchema>;

export const RunSummarySchema = z
  .object({
    runId: z.string().min(1),
    projectId: ProjectIdSchema,
    sourceRevisionId: z.string().min(1),
    createdAt: z.string().min(1),
    finalResponseCount: z.number().int().nonnegative(),
  })
  .strict();
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunExportFormatSchema = z.enum(["csv", "xlsx"]);
export type RunExportFormat = z.infer<typeof RunExportFormatSchema>;

export const RunsExportParamsSchema = z
  .object({
    runId: z.string().min(1),
    format: RunExportFormatSchema,
  })
  .strict();
export type RunsExportParams = z.infer<typeof RunsExportParamsSchema>;

export const RunsExportResultSchema = z.object({ status: z.enum(["saved", "cancelled"]) }).strict();
export type RunsExportResult = z.infer<typeof RunsExportResultSchema>;

const EmptyParamsSchema = z.object({}).strict();
const AccountIdParamsSchema = z.object({ id: GoogleAccountIdSchema }).strict();
const ProjectParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
const RunParamsSchema = z.object({ runId: z.string().min(1) }).strict();
const SynthesisCancelParamsSchema = z.object({ operationId: z.string().min(1).max(200) }).strict();
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
const TargetsProfileParamsSchema = z
  .object({ projectId: ProjectIdSchema, sourceScope: SourceScopeSchema.optional() })
  .strict();
const TargetsDraftStartParamsSchema = z
  .object({ projectId: ProjectIdSchema, operationId: z.string().min(1).max(200).optional() })
  .strict();

export interface BackendRpc {
  "system.ping": { input: z.infer<typeof EmptyParamsSchema>; output: SystemPingResult };
  "session.get": { input: z.infer<typeof EmptyParamsSchema>; output: SessionView | null };
  "auth.login": { input: z.infer<typeof EmptyParamsSchema>; output: SessionView };
  "auth.accounts": { input: z.infer<typeof EmptyParamsSchema>; output: GoogleAccountListItem[] };
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
  "projects.open": { input: z.infer<typeof ProjectParamsSchema>; output: ProjectDetailView | null };
  "projects.sourceReview": {
    input: z.infer<typeof ProjectParamsSchema>;
    output: ProjectSourceReviewResult;
  };
  "projects.refreshSource": {
    input: ProjectSourceRefreshParams;
    output: ProjectSourceRefreshResult;
  };
  "projects.delete": { input: z.infer<typeof ProjectParamsSchema>; output: ActionResult };
  "valueGroups.list": {
    input: z.infer<typeof ValueGroupsListParamsSchema>;
    output: ValueGroupView[];
  };
  "valueGroups.values": {
    input: z.infer<typeof ValueGroupsValuesParamsSchema>;
    output: ValueGroupObservedValue[];
  };
  "valueGroups.create": {
    input: z.infer<typeof ValueGroupsCreateParamsSchema>;
    output: ValueGroupView;
  };
  "valueGroups.delete": {
    input: z.infer<typeof ValueGroupsDeleteParamsSchema>;
    output: ActionResult;
  };
  "targets.profile": {
    input: z.infer<typeof TargetsProfileParamsSchema>;
    output: TargetProfileResult;
  };
  "targets.validate": { input: TargetDraft; output: TargetsValidateResult };
  "targets.draft.get": {
    input: z.infer<typeof ProjectParamsSchema>;
    output: TargetDraftView | null;
  };
  "targets.draft.save": { input: TargetDraft; output: TargetDraftView };
  "targets.draft.start": {
    input: z.infer<typeof TargetsDraftStartParamsSchema>;
    output: SynthesisStartResult;
  };
  "synthesis.start": { input: SynthesisStartParams; output: SynthesisStartResult };
  "synthesis.resolveEditPlan": {
    input: SynthesisResolveEditPlanParams;
    output: SynthesisSuccessResult;
  };
  "synthesis.cancel": { input: z.infer<typeof SynthesisCancelParamsSchema>; output: ActionResult };
  "runs.list": { input: z.infer<typeof ProjectParamsSchema>; output: RunSummary[] };
  "runs.get": { input: z.infer<typeof RunParamsSchema>; output: RunsGetResult };
  "runs.export": { input: RunsExportParams; output: RunsExportResult };
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
  "projects.open",
  "projects.sourceReview",
  "projects.refreshSource",
  "projects.delete",
  "valueGroups.list",
  "valueGroups.values",
  "valueGroups.create",
  "valueGroups.delete",
  "targets.profile",
  "targets.validate",
  "targets.draft.get",
  "targets.draft.save",
  "targets.draft.start",
  "synthesis.start",
  "synthesis.resolveEditPlan",
  "synthesis.cancel",
  "runs.list",
  "runs.get",
  "runs.export",
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
  "projects.open": ProjectParamsSchema,
  "projects.sourceReview": ProjectParamsSchema,
  "projects.refreshSource": ProjectSourceRefreshParamsSchema,
  "projects.delete": ProjectParamsSchema,
  "valueGroups.list": ValueGroupsListParamsSchema,
  "valueGroups.values": ValueGroupsValuesParamsSchema,
  "valueGroups.create": ValueGroupsCreateParamsSchema,
  "valueGroups.delete": ValueGroupsDeleteParamsSchema,
  "targets.profile": TargetsProfileParamsSchema,
  "targets.validate": TargetDraftSchema,
  "targets.draft.get": ProjectParamsSchema,
  "targets.draft.save": TargetDraftSchema,
  "targets.draft.start": TargetsDraftStartParamsSchema,
  "synthesis.start": SynthesisStartParamsSchema,
  "synthesis.resolveEditPlan": SynthesisResolveEditPlanParamsSchema,
  "synthesis.cancel": SynthesisCancelParamsSchema,
  "runs.list": ProjectParamsSchema,
  "runs.get": RunParamsSchema,
  "runs.export": RunsExportParamsSchema,
};

const rpcResultSchemas: Record<RpcMethod, z.ZodTypeAny> = {
  "system.ping": SystemPingResultSchema,
  "session.get": SessionViewSchema.nullable(),
  "auth.login": SessionViewSchema,
  "auth.accounts": z.array(GoogleAccountListItemSchema),
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
  "projects.open": ProjectDetailSchema.nullable(),
  "projects.sourceReview": ProjectSourceReviewResultSchema,
  "projects.refreshSource": ProjectSourceRefreshResultSchema,
  "projects.delete": ActionResultSchema,
  "valueGroups.list": z.array(ValueGroupSchema),
  "valueGroups.values": z.array(ValueGroupObservedValueSchema),
  "valueGroups.create": ValueGroupSchema,
  "valueGroups.delete": ActionResultSchema,
  "targets.profile": TargetProfileResultSchema,
  "targets.validate": TargetsValidateResultSchema,
  "targets.draft.get": TargetDraftViewSchema.nullable(),
  "targets.draft.save": TargetDraftViewSchema,
  "targets.draft.start": SynthesisStartResultSchema,
  "synthesis.start": SynthesisStartResultSchema,
  "synthesis.resolveEditPlan": SynthesisSuccessResultSchema,
  "synthesis.cancel": ActionResultSchema,
  "runs.list": z.array(RunSummarySchema),
  "runs.get": RunsGetResultSchema,
  "runs.export": RunsExportResultSchema,
};

export const parseRpcRequest = (input: unknown): RequestEnvelope => {
  const request = RequestEnvelopeSchema.parse(input);
  rpcParamSchemas[request.method].parse(request.params);
  return request;
};

export const parseRpcResult = <M extends RpcMethod>(
  method: M,
  input: unknown,
): BackendRpc[M]["output"] => rpcResultSchemas[method].parse(input) as BackendRpc[M]["output"];

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
