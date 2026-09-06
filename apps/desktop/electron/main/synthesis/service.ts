import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import {
  EditPlanPreviewSchema,
  TargetSetOutcomeSchema,
  type EditPlanPreview,
  type FrozenRunTarget,
  type FrozenTargetSubject,
  type FrozenValueGroup,
  type RunTargetSnapshot,
  type RunsGetResult,
  type SourceScope,
  type SynthesisResolveEditPlanParams,
  type SynthesisStartParams,
  type SynthesisStartResult,
  type SynthesisSuccessResult,
  type TargetIssue,
} from "@survey-synth/contracts";
import type { FormSnapshot, QuestionId } from "@survey-synth/domain";

import type { PythonEngine } from "../compute/python-engine";
import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { getRunRecord, persistRun, type PersistRunInput } from "../persistence/run-store";
import { formSnapshots, valueGroups } from "../persistence/schema";
import {
  getProject,
  getSourceRevision,
  listSourceResponses,
  type StoredSourceResponse,
} from "../persistence/store";
import {
  createFlatTablePlan,
  multiChoiceOptionSupport,
  readResultParquet,
  RESPONSE_ID_COLUMN,
  TARGET_SCORE_COLUMN,
  TIMESTAMP_COLUMN,
  valueGroupMemberCells,
  writeSourceParquet,
  type DecodedRunRow,
} from "./flat-table";

export type CreateSynthesisServiceOptions = {
  db: SurveyDatabase;
  engine: PythonEngine;
  workRoot: string;
};

export interface SynthesisService {
  start(params: SynthesisStartParams): Promise<SynthesisStartResult>;
  resolveEditPlan(params: SynthesisResolveEditPlanParams): Promise<SynthesisSuccessResult>;
  cancel(operationId: string): boolean;
  getRun(runId: string): Promise<RunsGetResult>;
}

type FrozenScope = {
  revisionId: string;
  sourceScope: SourceScope;
  kind: "all" | "submitted_between";
  startMs?: number;
  endMs?: number;
  responseCount: number;
  responseSetHash: string;
  responses: StoredSourceResponse[];
};

type ValueGroupRecord = typeof valueGroups.$inferSelect;

type PendingEditPlan = {
  projectId: string;
  sourceRevisionId: string;
  scope: PersistRunInput["scope"];
  targetSnapshot: RunTargetSnapshot;
  seed: number;
  engineReport: Record<string, unknown>;
  appendOnlyRows: DecodedRunRow[];
  replacementRows: DecodedRunRow[];
  syntheticResponseCount: number;
  editPlan: EditPlanPreview;
};

type OutcomeTarget = Pick<FrozenRunTarget, "id" | "kind" | "value">;

const parseFormSnapshot = (schemaJson: string): FormSnapshot => {
  const parsed = JSON.parse(schemaJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  const form = parsed as Partial<FormSnapshot>;
  if (!Array.isArray(form.questions) || typeof form.formId !== "string") {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  return parsed as FormSnapshot;
};

const parseTimestamp = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw backendFailure("VALIDATION_FAILED", `${label} timestamp is invalid`);
  }
  return timestamp;
};

const subsetHash = (revisionId: string, responses: readonly StoredSourceResponse[]): string => {
  const hash = createHash("sha256");
  hash.update(revisionId);
  for (const response of responses) {
    hash.update("\0");
    hash.update(response.responseId);
  }
  return hash.digest("hex");
};

const freezeScope = (
  revisionId: string,
  revisionHash: string,
  responses: StoredSourceResponse[],
  requested: SourceScope | undefined,
): FrozenScope => {
  const sourceScope = requested ?? { kind: "all" as const };
  if (sourceScope.kind === "all") {
    return {
      revisionId,
      sourceScope,
      kind: "all",
      responseCount: responses.length,
      responseSetHash: revisionHash,
      responses,
    };
  }

  const startMs = parseTimestamp(sourceScope.start, "Start");
  const endMs = parseTimestamp(sourceScope.end, "End");
  if (startMs > endMs) {
    throw backendFailure("VALIDATION_FAILED", "SourceScope start must not be after end");
  }
  const selected = responses.filter(
    (response) => response.submittedAtMs >= startMs && response.submittedAtMs <= endMs,
  );
  return {
    revisionId,
    sourceScope: {
      kind: "submitted_between",
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
    kind: "submitted_between",
    startMs,
    endMs,
    responseCount: selected.length,
    responseSetHash: subsetHash(revisionId, selected),
    responses: selected,
  };
};

const loadForm = (db: SurveyDatabase, formSnapshotId: string): FormSnapshot => {
  const snapshot = db
    .select()
    .from(formSnapshots)
    .where(eq(formSnapshots.id, formSnapshotId))
    .get();
  if (!snapshot) throw backendFailure("INTERNAL", "Source revision Form snapshot is missing");
  return parseFormSnapshot(snapshot.schemaJson);
};

const parseMembers = (membersJson: string): string[] => {
  const parsed = JSON.parse(membersJson) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !value)) {
    throw backendFailure("INTERNAL", "Stored ValueGroup members are invalid");
  }
  return parsed;
};

const frozenValueGroup = (row: ValueGroupRecord, members: string[]): FrozenValueGroup => ({
  id: row.id,
  questionId: row.questionId,
  name: row.name,
  members,
});

const loadValueGroup = (
  db: SurveyDatabase,
  projectId: string,
  valueGroupId: string,
): { row: ValueGroupRecord; members: string[] } => {
  const row = db.select().from(valueGroups).where(eq(valueGroups.id, valueGroupId)).get();
  if (!row || row.projectId !== projectId) {
    throw backendFailure("VALIDATION_FAILED", "Target ValueGroup was not found in this project");
  }
  return { row, members: parseMembers(row.membersJson) };
};

const ensureGroupableQuestion = (form: FormSnapshot, questionId: string): void => {
  const question = form.questions.find((candidate) => candidate.id === questionId);
  if (!question || (question.kind !== "single_choice" && question.kind !== "text")) {
    throw backendFailure(
      "VALIDATION_FAILED",
      "ValueGroup targets require a single-choice or text population question",
    );
  }
};

const jsonRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const issue = (
  targetIds: readonly { id: unknown }[],
  code: TargetIssue["code"],
  message: string,
): TargetIssue => ({
  targetIds: targetIds.map((target) => String(target.id) as TargetIssue["targetIds"][number]),
  code,
  message,
});

const normalizeEngineIssue = (
  raw: { code: string; message: string },
  targets: readonly OutcomeTarget[],
): TargetIssue => {
  const code: TargetIssue["code"] =
    raw.code === "candidate_support" ||
    raw.code === "share_member_support" ||
    raw.code === "conditional_population_support"
      ? "candidate_support"
      : raw.code === "final_count_below_source"
        ? "immutable_source_conflict"
        : raw.code.includes("out_of_range")
          ? "out_of_range"
          : raw.code.includes("denominator")
            ? "zero_denominator"
            : raw.code.includes("missing") || raw.code.includes("requires")
              ? "domain_unsupported"
              : "target_conflict";
  return issue(targets, code, raw.message);
};

const targetSetOutcome = (value: unknown, targets: readonly OutcomeTarget[]) => {
  const record = jsonRecord(value);
  if (Array.isArray(record.targets)) return TargetSetOutcomeSchema.parse(record);

  const rawShares = Array.isArray(record.shares) ? record.shares.map(jsonRecord) : [];
  const rawConditionals = Array.isArray(record.conditionalShares)
    ? record.conditionalShares.map(jsonRecord)
    : [];

  return TargetSetOutcomeSchema.parse({
    targets: targets.flatMap((target) => {
      if (target.kind === "count") return [];
      if (target.kind === "mean") {
        if (
          typeof record.mean !== "number" ||
          typeof record.absoluteError !== "number" ||
          typeof record.exact !== "boolean"
        ) {
          return [];
        }
        return [{
          targetId: target.id,
          kind: "mean",
          requested: target.value,
          achieved: record.mean,
          absoluteError: record.absoluteError,
          exact: record.exact,
        }];
      }

      const values = target.kind === "share" ? rawShares : rawConditionals;
      const raw = values.find((candidate) => String(candidate.id) === String(target.id));
      if (!raw || typeof raw.share !== "number" || typeof raw.absoluteError !== "number") {
        return [];
      }
      return [{
        targetId: target.id,
        kind: target.kind,
        requested: target.value,
        achieved: raw.share,
        absoluteError: raw.absoluteError,
        exact: typeof raw.exact === "boolean" ? raw.exact : raw.absoluteError <= 1e-9,
        ...(typeof raw.numeratorCount === "number" ? { numeratorCount: raw.numeratorCount } : {}),
        ...(typeof raw.denominatorCount === "number" ? { denominatorCount: raw.denominatorCount } : {}),
      }];
    }),
  });
};

const availableEditPlan = (
  report: unknown,
  targets: readonly OutcomeTarget[],
): EditPlanPreview | null => {
  const raw = jsonRecord(jsonRecord(report).editPlan);
  if (raw.status !== "available") return null;
  try {
    return EditPlanPreviewSchema.parse({
      status: "available",
      replacementCount: raw.replacementCount,
      proposedReplacements: raw.proposedReplacements,
      appendOnlyOutcome: targetSetOutcome(raw.appendOnlyOutcome, targets),
      replacementOutcome: targetSetOutcome(raw.replacementOutcome, targets),
    });
  } catch {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an invalid EditPlan");
  }
};

const persistedScope = (scope: FrozenScope): PersistRunInput["scope"] => ({
  kind: scope.kind,
  ...(scope.startMs === undefined ? {} : { startMs: scope.startMs }),
  ...(scope.endMs === undefined ? {} : { endMs: scope.endMs }),
  responseCount: scope.responseCount,
  responseSetHash: scope.responseSetHash,
});

const persistCompletedRun = (
  db: SurveyDatabase,
  input: Omit<PersistRunInput, "id">,
): SynthesisSuccessResult => {
  const runId = randomUUID();
  persistRun(db, { id: runId, ...input });
  return {
    status: "success",
    runId,
    syntheticResponseCount: Math.max(0, input.finalResponseCount - input.scope.responseCount),
    finalResponseCount: input.finalResponseCount,
  };
};

export const createSynthesisService = ({
  db,
  engine,
  workRoot,
}: CreateSynthesisServiceOptions): SynthesisService => {
  const pendingPlans = new Map<string, PendingEditPlan>();

  return {
    start: async (params) => {
      const project = getProject(db, params.projectId);
      if (!project) throw backendFailure("NOT_FOUND", "Project was not found");
      if (!project.currentSourceRevisionId) {
        throw backendFailure("VALIDATION_FAILED", "Project has no imported source revision");
      }

      const revision = getSourceRevision(db, project.currentSourceRevisionId);
      if (!revision || revision.projectId !== project.id) {
        throw backendFailure("INTERNAL", "Project source revision is invalid");
      }
      const scope = freezeScope(
        revision.id,
        revision.responseSetHash,
        listSourceResponses(db, revision.id),
        params.sourceScope,
      );
      if (scope.responses.length === 0) {
        return {
          status: "infeasible",
          issues: [issue(params.targets, "candidate_support", "Selected SourceScope has no responses")],
        };
      }

      const counts = params.targets.filter((target) => target.kind === "count");
      const means = params.targets.filter((target) => target.kind === "mean");
      const shares = params.targets.filter((target) => target.kind === "share");
      const conditionals = params.targets.filter((target) => target.kind === "conditional_share");

      if (counts.length > 0) {
        return {
          status: "infeasible",
          issues: [
            issue(
              counts,
              "domain_unsupported",
              "Count targets are part of the public contract but are not executable by the current synthesis engine yet",
            ),
          ],
        };
      }
      if (means.length !== 1) {
        return {
          status: "infeasible",
          issues: [
            issue(
              means.length > 0 ? means : params.targets,
              "domain_unsupported",
              "The current synthesis engine requires exactly one mean target",
            ),
          ],
        };
      }
      if (shares.length > 1) {
        return {
          status: "infeasible",
          issues: [
            issue(
              shares,
              "domain_unsupported",
              "The current candidate generator supports at most one unconditional share target",
            ),
          ],
        };
      }

      const mean = means[0]!;
      const form = loadForm(db, revision.formSnapshotId);
      const meanQuestion = form.questions.find((question) => question.id === mean.questionId);
      if (!meanQuestion || meanQuestion.kind !== "ordinal") {
        throw backendFailure("VALIDATION_FAILED", "Mean target question is not ordinal");
      }
      if (mean.value < meanQuestion.min || mean.value > meanQuestion.max) {
        return {
          status: "infeasible",
          issues: [issue([mean], "out_of_range", "Mean target is outside the ordinal question range")],
        };
      }

      const plan = createFlatTablePlan(form, mean.questionId as QuestionId);
      const shareJobTargets: Array<{
        id: string;
        column: string;
        member_values: string[];
        value: number;
      }> = [];
      const conditionalJobTargets: Array<{
        id: string;
        population_column: string;
        population_member_values: string[];
        option_column: string;
        option_values: string[];
        schema_option_values: string[];
        value: number;
      }> = [];
      const frozenTargets: FrozenRunTarget[] = [{ ...mean }];

      for (const share of shares) {
        let column: string | undefined;
        let memberValues: string[] = [];
        let frozenSubject: FrozenTargetSubject;

        if (share.subject.kind === "value_group") {
          const { row, members } = loadValueGroup(db, project.id, share.subject.valueGroupId);
          ensureGroupableQuestion(form, row.questionId);
          column = plan.questionColumns.get(row.questionId as QuestionId);
          memberValues = valueGroupMemberCells(
            scope.responses,
            row.questionId as QuestionId,
            members,
          );
          frozenSubject = {
            kind: "value_group",
            valueGroup: frozenValueGroup(row, members),
          };
          if (memberValues.length === 0) {
            return {
              status: "infeasible",
              issues: [
                issue(
                  [share],
                  "candidate_support",
                  `ValueGroup “${row.name}” has no observed member values in this SourceScope`,
                ),
              ],
            };
          }
        } else if (share.subject.kind === "option") {
          const question = form.questions.find(
            (candidate) => candidate.id === share.subject.questionId,
          );
          if (!question || question.kind !== "single_choice") {
            throw backendFailure("VALIDATION_FAILED", "Option share subject must reference a single-choice question");
          }
          const option = question.options.find(
            (candidate) => String(candidate.key) === share.subject.optionKey,
          );
          if (!option) {
            throw backendFailure("VALIDATION_FAILED", "Option share subject was not found in the Form");
          }
          column = plan.questionColumns.get(question.id);
          memberValues = valueGroupMemberCells(scope.responses, question.id, [share.subject.optionKey]);
          if (memberValues.length === 0) {
            memberValues = [
              JSON.stringify({
                state: "answered",
                value: { kind: "single_choice", optionKey: option.key, label: option.label },
              }),
            ];
          }
          frozenSubject = {
            kind: "option",
            questionId: share.subject.questionId,
            optionKey: share.subject.optionKey,
          };
        } else {
          const question = form.questions.find(
            (candidate) => candidate.id === share.subject.questionId,
          );
          if (!question || question.kind !== "multi_choice") {
            throw backendFailure(
              "VALIDATION_FAILED",
              "Checkbox option share subject must reference a checkbox question",
            );
          }
          if (!question.options.some((option) => String(option.key) === share.subject.optionKey)) {
            throw backendFailure(
              "VALIDATION_FAILED",
              "Checkbox option share subject was not found in the Form",
            );
          }
          column = plan.questionColumns.get(question.id);
          memberValues = multiChoiceOptionSupport(
            scope.responses,
            question,
            share.subject.optionKey,
          ).optionValues;
          frozenSubject = {
            kind: "checkbox_option",
            questionId: share.subject.questionId,
            optionKey: share.subject.optionKey,
          };
        }

        if (!column) {
          throw backendFailure("INTERNAL", "Share subject is not available in the synthesis table");
        }
        shareJobTargets.push({
          id: String(share.id),
          column,
          member_values: memberValues,
          value: share.value,
        });
        frozenTargets.push({
          id: share.id,
          kind: "share",
          subject: frozenSubject,
          value: share.value,
        });
      }

      for (const target of conditionals) {
        const { row, members } = loadValueGroup(
          db,
          project.id,
          target.population.valueGroupId,
        );
        ensureGroupableQuestion(form, row.questionId);
        const populationColumn = plan.questionColumns.get(row.questionId as QuestionId);
        if (!populationColumn) {
          throw backendFailure(
            "INTERNAL",
            "Conditional population question is not available in the synthesis table",
          );
        }
        const populationMemberValues = valueGroupMemberCells(
          scope.responses,
          row.questionId as QuestionId,
          members,
        );
        if (populationMemberValues.length === 0) {
          return {
            status: "infeasible",
            issues: [
              issue(
                [target],
                "candidate_support",
                `ValueGroup “${row.name}” has no observed population values in this SourceScope`,
              ),
            ],
          };
        }

        const checkbox = form.questions.find((question) => question.id === target.questionId);
        if (!checkbox || checkbox.kind !== "multi_choice") {
          throw backendFailure(
            "VALIDATION_FAILED",
            "Conditional share targets require a checkbox question",
          );
        }
        if (!checkbox.options.some((option) => String(option.key) === target.optionKey)) {
          throw backendFailure(
            "VALIDATION_FAILED",
            "Conditional share option was not found in the Form",
          );
        }
        const optionColumn = plan.questionColumns.get(checkbox.id);
        if (!optionColumn) {
          throw backendFailure(
            "INTERNAL",
            "Conditional checkbox question is not available in the synthesis table",
          );
        }
        const optionSupport = multiChoiceOptionSupport(scope.responses, checkbox, target.optionKey);
        if (optionSupport.optionValues.length === 0) {
          throw backendFailure(
            "INTERNAL",
            "Validated checkbox option did not produce synthesis support",
          );
        }

        conditionalJobTargets.push({
          id: String(target.id),
          population_column: populationColumn,
          population_member_values: populationMemberValues,
          option_column: optionColumn,
          option_values: optionSupport.optionValues,
          schema_option_values: optionSupport.schemaOptionValues,
          value: target.value,
        });
        frozenTargets.push({
          id: target.id,
          kind: "conditional_share",
          value: target.value,
          population: {
            kind: "value_group",
            valueGroup: frozenValueGroup(row, members),
          },
          questionId: checkbox.id,
          optionKey: target.optionKey,
        });
      }

      const targetSnapshot: RunTargetSnapshot = {
        finalCount: params.finalCount,
        sourceScope: scope.sourceScope,
        targets: frozenTargets,
      };

      const operationId = params.operationId ?? `synthesis-${randomUUID()}`;
      const workDir = join(workRoot, operationId.replaceAll(/[^a-zA-Z0-9._-]/g, "_"));
      const sourcePath = join(workDir, "source.parquet");
      const resultPath = join(workDir, "result.parquet");
      const replacementResultPath = join(workDir, "result.replacement.parquet");
      const reportPath = join(workDir, "report.json");
      const jobPath = join(workDir, "job.json");

      await mkdir(workDir, { recursive: true });
      try {
        await writeSourceParquet(sourcePath, form, scope.responses, plan);
        await writeFile(
          jobPath,
          JSON.stringify(
            {
              protocol_version: 1,
              kind: "synthesize",
              source_parquet: "source.parquet",
              result_parquet: "result.parquet",
              report_json: "report.json",
              final_count: params.finalCount,
              mean_target: {
                column: TARGET_SCORE_COLUMN,
                value: mean.value,
                minimum: meanQuestion.min,
                maximum: meanQuestion.max,
              },
              share_targets: shareJobTargets,
              conditional_share_targets: conditionalJobTargets,
              seed: params.seed,
              id_column: RESPONSE_ID_COLUMN,
              categorical_columns: [...plan.questionColumns.values()],
              timestamp_column: TIMESTAMP_COLUMN,
              ...(scope.startMs === undefined
                ? {}
                : { timestamp_start: new Date(scope.startMs).toISOString() }),
              ...(scope.endMs === undefined
                ? {}
                : { timestamp_end: new Date(scope.endMs).toISOString() }),
            },
            null,
            2,
          ),
          "utf8",
        );

        const report = await engine.synthesize(operationId, jobPath, reportPath);
        if (report.status === "infeasible") {
          return {
            status: "infeasible",
            issues: report.issues.map((raw) => normalizeEngineIssue(raw, frozenTargets)),
          };
        }

        const appendOnlyRows = await readResultParquet(resultPath, form, scope.responses, plan);
        if (
          appendOnlyRows.length !== report.finalCount ||
          appendOnlyRows.length !== params.finalCount
        ) {
          throw backendFailure(
            "INTERNAL",
            "Synthesis result row count does not match the frozen target",
          );
        }

        const editPlan = availableEditPlan(report, frozenTargets);
        if (editPlan) {
          const replacementRows = await readResultParquet(
            replacementResultPath,
            form,
            scope.responses,
            plan,
          );
          if (replacementRows.length !== params.finalCount) {
            throw backendFailure(
              "INTERNAL",
              "Replacement preview row count does not match the frozen target",
            );
          }
          const expectedOriginalCount = scope.responseCount - editPlan.replacementCount;
          if (
            replacementRows.filter((row) => row.origin === "original").length !==
            expectedOriginalCount
          ) {
            throw backendFailure("INTERNAL", "Replacement preview does not match its EditPlan");
          }

          const planId = randomUUID();
          pendingPlans.set(planId, {
            projectId: project.id,
            sourceRevisionId: revision.id,
            scope: persistedScope(scope),
            targetSnapshot,
            seed: params.seed,
            engineReport: jsonRecord(report),
            appendOnlyRows,
            replacementRows,
            syntheticResponseCount: report.syntheticCount,
            editPlan,
          });
          return { status: "approval_required", planId, editPlan };
        }

        return persistCompletedRun(db, {
          projectId: project.id,
          sourceRevisionId: revision.id,
          scope: persistedScope(scope),
          finalResponseCount: report.finalCount,
          target: targetSnapshot,
          seed: params.seed,
          engineReport: report,
          rows: appendOnlyRows,
        });
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },

    resolveEditPlan: async ({ planId, choice }) => {
      const pending = pendingPlans.get(planId);
      if (!pending) {
        throw backendFailure("NOT_FOUND", "EditPlan is no longer available");
      }

      const useReplacement = choice === "replacement";
      const rawEditPlan = jsonRecord(pending.engineReport.editPlan);
      const rawReplacementOutcome = jsonRecord(rawEditPlan.replacementOutcome);
      const engineReport: Record<string, unknown> = {
        ...pending.engineReport,
        ...(useReplacement
          ? {
              achieved: pending.editPlan.replacementOutcome,
              quality:
                typeof rawReplacementOutcome.quality === "object" &&
                rawReplacementOutcome.quality !== null
                  ? rawReplacementOutcome.quality
                  : pending.engineReport.quality,
            }
          : {
              achieved: pending.editPlan.appendOnlyOutcome,
            }),
        editPlan: { ...rawEditPlan, decision: choice },
        validation: {
          ...jsonRecord(pending.engineReport.validation),
          replacementApplied: useReplacement,
          approvedReplacementCount: useReplacement ? pending.editPlan.replacementCount : 0,
        },
      };
      const targetSnapshot: RunTargetSnapshot = useReplacement
        ? { ...pending.targetSnapshot, editPlan: pending.editPlan }
        : pending.targetSnapshot;
      const rows = useReplacement ? pending.replacementRows : pending.appendOnlyRows;

      const result = persistCompletedRun(db, {
        projectId: pending.projectId,
        sourceRevisionId: pending.sourceRevisionId,
        scope: pending.scope,
        finalResponseCount: rows.length,
        target: targetSnapshot,
        seed: pending.seed,
        engineReport,
        rows,
      });
      pendingPlans.delete(planId);
      return {
        ...result,
        syntheticResponseCount: pending.syntheticResponseCount,
      };
    },

    cancel: (operationId) => engine.cancel(operationId),

    getRun: async (runId) => {
      const run = getRunRecord(db, runId);
      if (!run) throw backendFailure("NOT_FOUND", "Run was not found");
      return {
        runId: run.id,
        projectId: run.projectId,
        sourceRevisionId: run.sourceRevisionId,
        targetSnapshot: JSON.parse(run.targetJson) as RunsGetResult["targetSnapshot"],
        validation: jsonRecord(JSON.parse(run.engineReportJson) as unknown),
        finalResponseCount: run.finalResponseCount,
        appVersion: run.appVersion,
        engineVersion: run.engineVersion,
      };
    },
  };
};
