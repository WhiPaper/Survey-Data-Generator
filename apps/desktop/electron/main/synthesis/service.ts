import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type {
  FrozenRunTarget,
  RunTargetSnapshot,
  RunsGetResult,
  SourceScope,
  SynthesisStartParams,
  SynthesisStartResult,
} from "@survey-synth/contracts";
import type { FormSnapshot, QuestionId } from "@survey-synth/domain";

import type { PythonEngine } from "../compute/python-engine";
import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { getRunRecord, persistRun } from "../persistence/run-store";
import { formSnapshots, valueGroups } from "../persistence/schema";
import {
  getProject,
  getSourceRevision,
  listSourceResponses,
  type StoredSourceResponse,
} from "../persistence/store";
import {
  createFlatTablePlan,
  readResultParquet,
  RESPONSE_ID_COLUMN,
  TARGET_SCORE_COLUMN,
  TIMESTAMP_COLUMN,
  valueGroupMemberCells,
  writeSourceParquet,
} from "./flat-table";

export type CreateSynthesisServiceOptions = {
  db: SurveyDatabase;
  engine: PythonEngine;
  workRoot: string;
};

export interface SynthesisService {
  start(params: SynthesisStartParams): Promise<SynthesisStartResult>;
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

const jsonRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const createSynthesisService = ({
  db,
  engine,
  workRoot,
}: CreateSynthesisServiceOptions): SynthesisService => ({
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
        issues: [{ code: "empty_source_scope", message: "Selected SourceScope has no responses" }],
      };
    }

    const means = params.targets.filter((target) => target.kind === "mean");
    if (means.length !== 1) {
      throw backendFailure("VALIDATION_FAILED", "M5 requires exactly one ordinal mean target");
    }
    const mean = means[0]!;
    const form = loadForm(db, revision.formSnapshotId);
    const meanQuestion = form.questions.find((question) => question.id === mean.questionId);
    if (!meanQuestion || meanQuestion.kind !== "ordinal") {
      throw backendFailure("VALIDATION_FAILED", "Mean target question is not ordinal");
    }

    const plan = createFlatTablePlan(form, mean.questionId as QuestionId);
    const shareJobTargets: Array<{
      id: string;
      column: string;
      member_values: string[];
      value: number;
    }> = [];
    const frozenTargets: FrozenRunTarget[] = [{ ...mean }];

    for (const share of params.targets.filter((target) => target.kind === "share")) {
      const row = db.select().from(valueGroups).where(eq(valueGroups.id, share.valueGroupId)).get();
      if (!row || row.projectId !== project.id) {
        throw backendFailure("VALIDATION_FAILED", "Share target ValueGroup was not found in this project");
      }
      const members = parseMembers(row.membersJson);
      const question = form.questions.find((candidate) => candidate.id === row.questionId);
      if (!question || question.kind !== "single_choice") {
        throw backendFailure("VALIDATION_FAILED", "M5 share targets require a single-choice ValueGroup");
      }
      const column = plan.questionColumns.get(row.questionId as QuestionId);
      if (!column) {
        throw backendFailure("INTERNAL", "ValueGroup question is not available in the synthesis table");
      }
      const memberValues = valueGroupMemberCells(
        scope.responses,
        row.questionId as QuestionId,
        members,
      );
      if (memberValues.length === 0) {
        return {
          status: "infeasible",
          issues: [
            {
              code: "share_member_support",
              message: `ValueGroup “${row.name}” has no observed member values in this SourceScope`,
            },
          ],
        };
      }
      shareJobTargets.push({ id: row.id, column, member_values: memberValues, value: share.value });
      frozenTargets.push({
        kind: "share",
        value: share.value,
        valueGroup: {
          id: row.id,
          questionId: row.questionId,
          name: row.name,
          members,
        },
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
        return { status: "infeasible", issues: report.issues };
      }

      const rows = await readResultParquet(resultPath, form, scope.responses, plan);
      if (rows.length !== report.finalCount || rows.length !== params.finalCount) {
        throw backendFailure("INTERNAL", "Synthesis result row count does not match the frozen target");
      }

      const runId = randomUUID();
      persistRun(db, {
        id: runId,
        projectId: project.id,
        sourceRevisionId: revision.id,
        scope: {
          kind: scope.kind,
          ...(scope.startMs === undefined ? {} : { startMs: scope.startMs }),
          ...(scope.endMs === undefined ? {} : { endMs: scope.endMs }),
          responseCount: scope.responseCount,
          responseSetHash: scope.responseSetHash,
        },
        finalResponseCount: report.finalCount,
        target: targetSnapshot,
        seed: params.seed,
        engineReport: report,
        rows,
      });

      return {
        status: "success",
        runId,
        syntheticResponseCount: report.syntheticCount,
        finalResponseCount: report.finalCount,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
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
    };
  },
});
