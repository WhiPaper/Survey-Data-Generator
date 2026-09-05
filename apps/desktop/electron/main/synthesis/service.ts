import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type {
  RunsGetResult,
  SynthesisStartParams,
  SynthesisStartResult,
} from "@survey-synth/contracts";
import type { FormSnapshot, QuestionId } from "@survey-synth/domain";

import type { PythonEngine } from "../compute/python-engine";
import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { getRunRecord, persistRun } from "../persistence/run-store";
import { formSnapshots } from "../persistence/schema";
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
  timestampRange: SynthesisStartParams["timestampRange"],
): FrozenScope => {
  if (!timestampRange) {
    return {
      revisionId,
      kind: "all",
      responseCount: responses.length,
      responseSetHash: revisionHash,
      responses,
    };
  }

  const startMs = parseTimestamp(timestampRange.start, "Start");
  const endMs = parseTimestamp(timestampRange.end, "End");
  if (startMs > endMs) {
    throw backendFailure("VALIDATION_FAILED", "SourceScope start must not be after end");
  }
  const selected = responses.filter(
    (response) => response.submittedAtMs >= startMs && response.submittedAtMs <= endMs,
  );
  return {
    revisionId,
    kind: "submitted_between",
    startMs,
    endMs,
    responseCount: selected.length,
    responseSetHash: subsetHash(revisionId, selected),
    responses: selected,
  };
};

const meanTarget = (params: SynthesisStartParams): {
  questionId: QuestionId;
  value: number;
} => {
  if (params.targets.detailedGoals && params.targets.detailedGoals.length > 0) {
    throw backendFailure("VALIDATION_FAILED", "M4 supports one unconditional ordinal mean target only");
  }
  if (params.targets.questionTargets.length !== 1) {
    throw backendFailure("VALIDATION_FAILED", "M4 requires exactly one ordinal mean target");
  }
  const target = params.targets.questionTargets[0];
  if (!target || target.kind !== "mean" || target.target.kind !== "mean") {
    throw backendFailure("VALIDATION_FAILED", "M4 supports ordinal mean targets only");
  }
  return { questionId: target.questionId as QuestionId, value: target.target.value };
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
    const allResponses = listSourceResponses(db, revision.id);
    const scope = freezeScope(
      revision.id,
      revision.responseSetHash,
      allResponses,
      params.timestampRange,
    );
    if (scope.responses.length === 0) {
      return {
        status: "infeasible",
        issues: [{ code: "empty_source_scope", message: "Selected SourceScope has no responses" }],
      };
    }

    const target = meanTarget(params);
    const form = loadForm(db, revision.formSnapshotId);
    const question = form.questions.find((candidate) => candidate.id === target.questionId);
    if (!question) throw backendFailure("VALIDATION_FAILED", "Mean target question was not found");
    if (question.kind !== "ordinal") {
      throw backendFailure("VALIDATION_FAILED", "Mean target question is not ordinal");
    }

    const operationId = params.operationId ?? `synthesis-${randomUUID()}`;
    const workDir = join(workRoot, operationId.replaceAll(/[^a-zA-Z0-9._-]/g, "_"));
    const sourcePath = join(workDir, "source.parquet");
    const resultPath = join(workDir, "result.parquet");
    const reportPath = join(workDir, "report.json");
    const jobPath = join(workDir, "job.json");
    const plan = createFlatTablePlan(form, target.questionId);

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
            final_count: params.targets.targetResponseCount,
            mean_target: {
              column: TARGET_SCORE_COLUMN,
              value: target.value,
              minimum: question.min,
              maximum: question.max,
            },
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
      if (rows.length !== report.finalCount || rows.length !== params.targets.targetResponseCount) {
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
        target: params.targets,
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
    const targetSnapshot = JSON.parse(run.targetJson) as RunsGetResult["targetSnapshot"];
    const engineReport = JSON.parse(run.engineReportJson) as unknown;
    return {
      runId: run.id,
      projectId: run.projectId,
      sourceRevisionId: run.sourceRevisionId,
      targetSnapshot,
      targetRevision: 0,
      validation: jsonRecord(engineReport),
      finalResponseCount: run.finalResponseCount,
    };
  },
});
