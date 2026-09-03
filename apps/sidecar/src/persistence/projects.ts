import { createHash, randomUUID } from "node:crypto";
import type {
  AnswerSlot,
  DomainSemanticOverride,
  FormSnapshot,
  GoogleAccountId,
  NormalizedResponse,
  ProjectId,
  ProjectTargets,
  QuestionId,
  RunId,
  ProjectSummary,
  SourceRevisionId,
  SynthesisProject,
  TargetMigrationIssue,
} from "@survey-synth/domain";
import { resolveResponsePath, type SynthesisRun } from "@survey-synth/domain";
import type { ValidationResult } from "@survey-synth/synthesis-core";
import {
  LegacyCompatibilityOutcomeSchema,
  VERSIONS,
  type AiMetadata,
  type LegacyCompatibilityOutcome,
  type LegacyCompatibilityReason,
} from "@survey-synth/contracts";
import {
  analyzeRelationships,
  profileForm,
  type QuestionProfile,
  type RelationshipProfile,
  type SemanticInference,
} from "@survey-synth/statistics";
import { ProjectDatabase } from "./database.js";
import { sidecarError } from "../errors.js";

export interface CreatedProject {
  readonly project: SynthesisProject;
  readonly profiles: readonly QuestionProfile[];
  readonly relationships: readonly RelationshipProfile[];
}

export interface ProjectDetail extends ProjectSummary {
  readonly form: FormSnapshot;
  readonly targets: ProjectTargets;
  readonly targetRevision: number;
  readonly profiles: readonly QuestionProfile[];
  readonly relationships: readonly RelationshipProfile[];
  readonly migrationIssues?: readonly TargetMigrationIssue[];
}

export interface SynthesisSource {
  readonly form: FormSnapshot;
  readonly responses: readonly NormalizedResponse[];
  readonly sourceRevisionId: SourceRevisionId;
  readonly relationships: readonly RelationshipProfile[];
}

export interface HistoricalRunExportData {
  readonly run: {
    readonly id: RunId;
    readonly projectId: ProjectId;
    readonly sourceRevisionId: SourceRevisionId;
    readonly targetSnapshot: ProjectTargets;
    readonly targetRevision: number;
    readonly seed: number;
    readonly engineVersion: number;
    readonly profilerVersion: number;
    readonly appVersion: string;
    readonly createdAt: string;
    readonly validation: ValidationResult;
    readonly finalResponseCount: number;
  };
  readonly form: FormSnapshot;
  readonly originalResponses: readonly NormalizedResponse[];
  readonly syntheticResponses: readonly NormalizedResponse[];
  readonly timeZone: string;
  readonly semanticInferences: readonly {
    readonly questionId: QuestionId;
    readonly value: string;
  }[];
  readonly semanticOverrides: readonly DomainSemanticOverride[];
}

export type LegacyCompatibilityRequired = Omit<LegacyCompatibilityOutcome, "runId"> & {
  readonly runId: RunId;
};

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const parseStoredJson = <T>(json: string, message: string): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw sidecarError("BACKEND_UNAVAILABLE", message, false);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isAnswerValue = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "single_choice":
      return typeof value.optionKey === "string" && typeof value.label === "string";
    case "multi_choice":
      return isStringArray(value.optionKeys) && isStringArray(value.labels);
    case "ordinal":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "text":
      return typeof value.value === "string";
    case "date":
      return (
        typeof value.value === "string" &&
        typeof value.includeTime === "boolean" &&
        typeof value.includeYear === "boolean"
      );
    case "time":
      return typeof value.value === "string" && typeof value.duration === "boolean";
    case "file":
      return (
        Array.isArray(value.files) &&
        value.files.every(
          (file) =>
            isRecord(file) &&
            (file.fileName === undefined || typeof file.fileName === "string") &&
            (file.mimeType === undefined || typeof file.mimeType === "string"),
        )
      );
    case "unsupported":
      return isStringArray(value.values);
    default:
      return false;
  }
};

const isAnswerSlot = (value: unknown): value is AnswerSlot => {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "answered") return isAnswerValue(value.value);
  return (
    value.state === "skipped" || value.state === "not_reached" || value.state === "indeterminate"
  );
};

const isPathResolution = (value: unknown): value is NormalizedResponse["path"] =>
  isRecord(value) &&
  ((isRecord(value.questions) &&
    Object.values(value.questions).every(
      (state) => state === "reached" || state === "not_reached" || state === "indeterminate",
    ) &&
    (value.confidence === "certain" ||
      value.confidence === "partial" ||
      value.confidence === "ambiguous")) ||
    (Array.isArray(value.visitedQuestionIds) && typeof value.status === "string"));

const parseStoredAnswerSlot = (json: string): AnswerSlot => {
  const slot = parseStoredJson<unknown>(json, "Historical response answer is corrupt");
  if (!isAnswerSlot(slot)) {
    throw sidecarError("BACKEND_UNAVAILABLE", "Historical response answer is corrupt", false);
  }
  return slot;
};

const parseStoredPath = (json: string): NormalizedResponse["path"] => {
  const path = parseStoredJson<unknown>(json, "Historical response path is corrupt");
  if (!isPathResolution(path)) {
    throw sidecarError("BACKEND_UNAVAILABLE", "Historical response path is corrupt", false);
  }
  return path;
};

const parseStoredSyntheticResponse = (
  json: string,
  expectedResponseId: string,
): NormalizedResponse => {
  const response = parseStoredJson<unknown>(json, "Synthetic response is corrupt");
  if (
    !isRecord(response) ||
    typeof response.responseId !== "string" ||
    response.responseId !== expectedResponseId ||
    response.origin !== "synthetic" ||
    !isRecord(response.answers) ||
    !Object.values(response.answers).every(isAnswerSlot) ||
    !isPathResolution(response.path) ||
    (response.createdAt !== undefined && typeof response.createdAt !== "string") ||
    (response.lastSubmittedAt !== undefined && typeof response.lastSubmittedAt !== "string")
  ) {
    throw sidecarError("BACKEND_UNAVAILABLE", "Synthetic response is corrupt", false);
  }
  return response as unknown as NormalizedResponse;
};

const isPersistedValidation = (value: unknown): value is ValidationResult =>
  isRecord(value) &&
  typeof value.valid === "boolean" &&
  typeof value.originalMutationCount === "number" &&
  Number.isInteger(value.originalMutationCount) &&
  value.originalMutationCount === 0 &&
  typeof value.finalResponseCount === "number" &&
  Number.isInteger(value.finalResponseCount) &&
  value.finalResponseCount >= 0 &&
  Array.isArray(value.metrics) &&
  Array.isArray(value.errors);

const isPersistedTargetSnapshot = (value: unknown): value is ProjectTargets =>
  isRecord(value) &&
  typeof value.targetResponseCount === "number" &&
  Number.isInteger(value.targetResponseCount) &&
  value.targetResponseCount >= 0 &&
  Array.isArray(value.questionTargets) &&
  (value.detailedGoals === undefined || Array.isArray(value.detailedGoals));

const isPersistedFormSnapshot = (value: unknown): value is FormSnapshot =>
  isRecord(value) &&
  typeof value.formId === "string" &&
  typeof value.title === "string" &&
  typeof value.capturedAt === "string" &&
  typeof value.schemaHash === "string" &&
  Array.isArray(value.questions) &&
  Array.isArray(value.groups) &&
  (value.logic === undefined || isRecord(value.logic));

const validateProjectTimeZone = (timeZone: string | null | undefined): string => {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throw sidecarError("VALIDATION_FAILED", "Project timezone is unavailable", true);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw sidecarError("VALIDATION_FAILED", "Project timezone is invalid", false);
  }
  return timeZone;
};

const captureProjectTimeZone = (): string =>
  validateProjectTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

const legacyCompatibilityRequired = (
  runId: RunId,
  reason: LegacyCompatibilityReason,
): LegacyCompatibilityRequired => ({
  kind: "legacy_compatibility_required",
  runId,
  reason,
  supportedSinceDatabaseSchemaVersion: reason === "missing_project_timezone" ? 8 : 9,
});

const throwLegacyCompatibilityRequired = (outcome: LegacyCompatibilityRequired): never => {
  const message =
    outcome.reason === "missing_project_timezone"
      ? "Historical export requires a persisted project timezone; this legacy project has none"
      : "Historical export requires a frozen semantic override snapshot; this legacy Run has none";
  throw sidecarError(
    "LEGACY_COMPATIBILITY_REQUIRED",
    message,
    false,
    LegacyCompatibilityOutcomeSchema.parse(outcome),
  );
};

/**
 * A valid IANA value already persisted on the project row is the only accepted
 * legacy timezone evidence. Response offsets, timestamps, and the current OS
 * timezone do not prove the historical project timezone.
 */
const resolveHistoricalProjectTimeZone = (
  runId: RunId,
  timeZone: string | null | undefined,
): string => {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throwLegacyCompatibilityRequired(
      legacyCompatibilityRequired(runId, "missing_project_timezone"),
    );
  }
  return validateProjectTimeZone(timeZone);
};

const responseContentHash = (response: NormalizedResponse): string =>
  hash({
    createdAt: response.createdAt,
    lastSubmittedAt: response.lastSubmittedAt,
    answers: response.answers,
    path: response.path,
  });

export class ProjectRepository {
  public constructor(private readonly database: ProjectDatabase) {}

  public list(): ProjectSummary[] {
    return this.database
      .prepare<ProjectSummary>(
        `SELECT p.id, p.google_account_id AS googleAccountId, p.google_form_id AS googleFormId, p.name, p.time_zone AS timeZone, p.current_source_revision_id AS currentSourceRevisionId, p.created_at AS createdAt, p.updated_at AS updatedAt, COALESCE((SELECT COUNT(*) FROM revision_response_versions rrv WHERE rrv.revision_id = p.current_source_revision_id), (SELECT COUNT(*) FROM revision_responses rr WHERE rr.revision_id = p.current_source_revision_id), 0) AS responseCount, (SELECT json_array_length(fs.payload_json, '$.questions') FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=p.current_source_revision_id) AS questionCount, (SELECT COUNT(*) FROM question_profiles qp WHERE qp.revision_id=p.current_source_revision_id) AS profileCount FROM projects p ORDER BY p.updated_at DESC`,
      )
      .all();
  }

  public createFromImport(
    accountId: GoogleAccountId,
    form: FormSnapshot,
    responses: readonly NormalizedResponse[],
    importedAt = new Date().toISOString(),
    timeZone = captureProjectTimeZone(),
  ): CreatedProject {
    const projectId = randomUUID() as ProjectId;
    const revisionId = randomUUID() as SourceRevisionId;
    const snapshotId = randomUUID();
    const now = importedAt;
    const project: SynthesisProject = {
      id: projectId,
      googleAccountId: accountId,
      googleFormId: form.formId,
      name: form.title,
      timeZone: validateProjectTimeZone(timeZone),
      currentSourceRevisionId: revisionId,
      createdAt: now,
      updatedAt: now,
    };
    const profiles = profileForm(form, responses);
    const relationships = analyzeRelationships(form, responses);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects (id,google_account_id,google_form_id,name,time_zone,current_source_revision_id,created_at,updated_at) VALUES (@id,@googleAccountId,@googleFormId,@name,@timeZone,@currentSourceRevisionId,@createdAt,@updatedAt)`,
        )
        .run(project);
      this.database
        .prepare(`INSERT INTO form_snapshots VALUES (@id,@formId,@schemaHash,@capturedAt,@payload)`)
        .run({
          id: snapshotId,
          formId: form.formId,
          schemaHash: form.schemaHash,
          capturedAt: form.capturedAt,
          payload: JSON.stringify(form),
        });
      this.database
        .prepare(
          `INSERT INTO source_revisions VALUES (@id,@projectId,@formSnapshotId,@sourceResponseCount,@responseSetHash,@schemaHash,@capturedAt,@importedAt,NULL)`,
        )
        .run({
          id: revisionId,
          projectId,
          formSnapshotId: snapshotId,
          sourceResponseCount: responses.length,
          responseSetHash: hash(
            [...responses]
              .map((response) => ({
                id: response.responseId,
                contentHash: responseContentHash(response),
              }))
              .sort((a, b) => String(a.id).localeCompare(String(b.id))),
          ),
          schemaHash: form.schemaHash,
          capturedAt: form.capturedAt,
          importedAt,
        });
      const responseInsert = this.database.prepare(
        `INSERT INTO responses (id,created_at,last_submitted_at,content_hash,origin,path_json) VALUES (@id,@createdAt,@lastSubmittedAt,@contentHash,'original',@path)`,
      );
      const membershipInsert = this.database.prepare(`INSERT INTO revision_responses VALUES (?,?)`);
      const answerInsert = this.database.prepare(`INSERT INTO answers VALUES (?,?,?)`);

      const versionInsert = this.database.prepare(
        `INSERT OR IGNORE INTO response_versions (id,response_id,created_at,last_submitted_at,content_hash,origin,path_json) VALUES (@id,@responseId,@createdAt,@lastSubmittedAt,@contentHash,'original',@path)`,
      );
      const versionMembershipInsert = this.database.prepare(
        `INSERT OR IGNORE INTO revision_response_versions VALUES (?,?)`,
      );
      const versionAnswerInsert = this.database.prepare(
        `INSERT OR IGNORE INTO response_version_answers VALUES (?,?,?)`,
      );

      for (const response of responses) {
        const contentHash = responseContentHash(response);
        const versionId = `${response.responseId}:${contentHash}`;

        responseInsert.run({
          id: response.responseId,
          createdAt: response.createdAt ?? null,
          lastSubmittedAt: response.lastSubmittedAt ?? null,
          contentHash,
          path: JSON.stringify(response.path),
        });
        membershipInsert.run(revisionId, response.responseId);
        for (const [questionId, slot] of Object.entries(response.answers))
          answerInsert.run(response.responseId, questionId, JSON.stringify(slot));

        versionInsert.run({
          id: versionId,
          responseId: response.responseId,
          createdAt: response.createdAt ?? null,
          lastSubmittedAt: response.lastSubmittedAt ?? null,
          contentHash,
          path: JSON.stringify(response.path),
        });
        versionMembershipInsert.run(revisionId, versionId);
        for (const [questionId, slot] of Object.entries(response.answers))
          versionAnswerInsert.run(versionId, questionId, JSON.stringify(slot));
      }
      const profileInsert = this.database.prepare(`INSERT INTO question_profiles VALUES (?,?,?,?)`);
      for (const profile of profiles)
        profileInsert.run(
          revisionId,
          profile.questionId,
          VERSIONS.profilerVersion,
          JSON.stringify(profile),
        );
      const relationshipInsert = this.database.prepare(
        `INSERT INTO relationship_profiles VALUES (?,?,?,?,?)`,
      );
      for (const relationship of relationships)
        relationshipInsert.run(
          revisionId,
          relationship.questionA,
          relationship.questionB,
          VERSIONS.profilerVersion,
          JSON.stringify(relationship),
        );
    });
    return { project, profiles, relationships };
  }

  public get(id: ProjectId): ProjectDetail | null {
    const summary = this.list().find((project) => project.id === id);
    if (summary === undefined) return null;
    const revisionId = summary.currentSourceRevisionId;
    const formRow = this.database
      .prepare<{ payload_json: string }>(
        "SELECT fs.payload_json FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=?",
      )
      .get(revisionId);
    if (formRow === undefined) return null;
    const targetState = this.getTargets(id);
    const profiles = this.database
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM question_profiles WHERE revision_id=?",
      )
      .all(revisionId)
      .map((row) => JSON.parse(row.payload_json) as QuestionProfile);
    const relationships = this.database
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM relationship_profiles WHERE revision_id=?",
      )
      .all(revisionId)
      .map((row) => JSON.parse(row.payload_json) as RelationshipProfile);
    const migrationIssues = this.getMigrationIssues(id, revisionId);
    return {
      ...summary,
      form: JSON.parse(formRow.payload_json) as FormSnapshot,
      targets: targetState.targets,
      targetRevision: targetState.revision,
      profiles,
      relationships,
      ...(migrationIssues.length === 0 ? {} : { migrationIssues }),
    };
  }

  public getTargets(id: ProjectId): {
    revision: number;
    targets: ProjectTargets;
    issues?: readonly TargetMigrationIssue[];
  } {
    const issues = this.getMigrationIssues(id);
    const row = this.database
      .prepare<{ revision: number; payload_json: string }>(
        "SELECT revision, payload_json FROM target_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(id);
    if (row !== undefined)
      return {
        revision: row.revision,
        targets: JSON.parse(row.payload_json) as ProjectTargets,
        ...(issues.length === 0 ? {} : { issues }),
      };
    const project = this.list().find((item) => item.id === id);
    if (project === undefined) throw sidecarError("NOT_FOUND", "Project was not found", true);
    return {
      revision: 0,
      targets: { targetResponseCount: project.responseCount, questionTargets: [] },
      ...(issues.length === 0 ? {} : { issues }),
    };
  }

  public updateTargets(
    id: ProjectId,
    expectedRevision: number,
    targets: ProjectTargets,
  ): { revision: number; targets: ProjectTargets; issues?: readonly TargetMigrationIssue[] } {
    return this.database.transaction(() => {
      const current = this.getTargets(id);
      if (current.revision !== expectedRevision)
        throw sidecarError("TARGET_CONFLICT", "Target revision is out of date", true);

      if (JSON.stringify(current.targets) === JSON.stringify(targets)) return current;
      const migrationIssues = this.getMigrationIssues(id);
      const next = {
        revision: current.revision + 1,
        targets,
        ...(migrationIssues.length === 0 ? {} : { issues: migrationIssues }),
      };
      this.database
        .prepare(
          "INSERT INTO target_revisions (project_id, revision, payload_json, created_at) VALUES (?,?,?,?)",
        )
        .run(id, next.revision, JSON.stringify(targets), new Date().toISOString());
      return next;
    });
  }

  private loadRevisionResponses(
    revisionId: SourceRevisionId,
    form: FormSnapshot,
    projectId?: ProjectId,
  ): NormalizedResponse[] {
    const revisionRow = this.database
      .prepare<{ source_response_count: number; project_id: string }>(
        "SELECT source_response_count, project_id FROM source_revisions WHERE id=?",
      )
      .get(revisionId);
    if (revisionRow === undefined) {
      throw sidecarError("NOT_FOUND", "Source revision was not found", false);
    }
    if (projectId !== undefined && revisionRow.project_id !== projectId) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Run source revision ownership is corrupt", false);
    }
    const expectedCount = revisionRow.source_response_count;
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Source revision response count is corrupt", false);
    }

    const storageTableNames = this.database
      .prepare<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('response_versions','response_version_answers','revision_response_versions','target_migration_issues','semantic_overrides')",
      )
      .all()
      .map((row) => row.name);
    const canonicalTableCount = storageTableNames.filter((name) =>
      ["response_versions", "response_version_answers", "revision_response_versions"].includes(
        name,
      ),
    ).length;
    if (canonicalTableCount > 0 && canonicalTableCount < 3) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Versioned response storage is incomplete", false);
    }
    if (
      canonicalTableCount === 0 &&
      storageTableNames.some((name) =>
        ["target_migration_issues", "semantic_overrides"].includes(name),
      )
    ) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Versioned response storage is incomplete", false);
    }

    type ResponseRow = {
      id: string;
      created_at: string | null;
      last_submitted_at: string | null;
      path_json: string;
      version_id: string;
    };
    const versionRows =
      canonicalTableCount === 3
        ? this.database
            .prepare<ResponseRow>(
              "SELECT rv.response_id AS id, rv.created_at, rv.last_submitted_at, rv.path_json, rrv.response_version_id AS version_id FROM response_versions rv JOIN revision_response_versions rrv ON rrv.response_version_id=rv.id WHERE rrv.revision_id=? ORDER BY rv.response_id",
            )
            .all(revisionId)
        : [];

    if (canonicalTableCount === 3) {
      if (versionRows.length !== expectedCount) {
        throw sidecarError(
          "BACKEND_UNAVAILABLE",
          `Source revision response membership is incomplete: expected ${expectedCount}, found ${versionRows.length}`,
          false,
        );
      }
      if (new Set(versionRows.map((row) => row.id)).size !== expectedCount) {
        throw sidecarError(
          "BACKEND_UNAVAILABLE",
          "Source revision contains duplicate response versions",
          false,
        );
      }
      if (versionRows.length === 0) {
        const legacyCount = this.database
          .prepare<{ count: number }>(
            "SELECT COUNT(*) AS count FROM revision_responses WHERE revision_id=?",
          )
          .get(revisionId)?.count;
        if (legacyCount !== 0) {
          throw sidecarError(
            "BACKEND_UNAVAILABLE",
            "Source revision response storage is mixed",
            false,
          );
        }
      }
      const answers = this.database.prepare<{ question_id: string; slot_json: string }>(
        "SELECT question_id, slot_json FROM response_version_answers WHERE version_id=?",
      );
      return versionRows.map((row) => {
        const responseAnswers = Object.fromEntries(
          answers
            .all(row.version_id)
            .map((answer) => [answer.question_id, parseStoredAnswerSlot(answer.slot_json)]),
        ) as NormalizedResponse["answers"];
        return {
          responseId: row.id as never,
          createdAt: row.created_at ?? undefined,
          lastSubmittedAt: row.last_submitted_at ?? undefined,
          answers: responseAnswers,
          origin: "original" as const,
          path:
            row.path_json === "{}"
              ? resolveResponsePath(form, responseAnswers)
              : parseStoredPath(row.path_json),
        };
      });
    }

    const legacyRows = this.database
      .prepare<ResponseRow>(
        "SELECT r.id, r.created_at, r.last_submitted_at, r.path_json FROM responses r JOIN revision_responses rr ON rr.response_id=r.id WHERE rr.revision_id=? ORDER BY r.id",
      )
      .all(revisionId);
    if (legacyRows.length !== expectedCount) {
      throw sidecarError(
        "BACKEND_UNAVAILABLE",
        `Source revision response membership is incomplete: expected ${expectedCount}, found ${legacyRows.length}`,
        false,
      );
    }
    const answers = this.database.prepare<{ question_id: string; slot_json: string }>(
      "SELECT question_id, slot_json FROM answers WHERE response_id=?",
    );
    return legacyRows.map((row) => {
      const responseAnswers = Object.fromEntries(
        answers
          .all(row.id)
          .map((answer) => [answer.question_id, parseStoredAnswerSlot(answer.slot_json)]),
      ) as NormalizedResponse["answers"];
      return {
        responseId: row.id as never,
        createdAt: row.created_at ?? undefined,
        lastSubmittedAt: row.last_submitted_at ?? undefined,
        answers: responseAnswers,
        origin: "original" as const,
        path:
          row.path_json === "{}"
            ? resolveResponsePath(form, responseAnswers)
            : parseStoredPath(row.path_json),
      };
    });
  }

  public loadSynthesisSource(
    id: ProjectId,
    targetRevisionId?: SourceRevisionId,
  ): SynthesisSource | null {
    const summary = this.list().find((project) => project.id === id);
    if (summary === undefined) return null;
    const revisionId = targetRevisionId ?? summary.currentSourceRevisionId;
    const snapshot = this.database
      .prepare<{ payload_json: string }>(
        "SELECT fs.payload_json FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=?",
      )
      .get(revisionId);
    if (snapshot === undefined) return null;
    const form = parseStoredJson<FormSnapshot>(snapshot.payload_json, "Form snapshot is corrupt");
    const responses = this.loadRevisionResponses(revisionId, form, id);

    const relationships = this.database
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM relationship_profiles WHERE revision_id=? ORDER BY question_a, question_b",
      )
      .all(revisionId)
      .map((row) =>
        parseStoredJson<RelationshipProfile>(row.payload_json, "Relationship profile is corrupt"),
      );
    return {
      form,
      responses,
      sourceRevisionId: revisionId,
      relationships,
    };
  }

  public getMigrationIssues(
    projectId: ProjectId,
    sourceRevisionId?: SourceRevisionId,
  ): TargetMigrationIssue[] {
    const summary = this.list().find((p) => p.id === projectId);
    if (summary === undefined) return [];
    const revId = sourceRevisionId ?? summary.currentSourceRevisionId;
    return this.database
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM target_migration_issues WHERE project_id=? AND source_revision_id=? AND resolved=0 ORDER BY issue_id",
      )
      .all(projectId, revId)
      .map((row) => JSON.parse(row.payload_json) as TargetMigrationIssue);
  }

  public resolveMigrationIssue(
    projectId: ProjectId,
    issueId: string,
    resolution?: "acknowledge" | "remove_target",
  ): void {
    this.database.transaction(() => {
      const summary = this.list().find((p) => p.id === projectId);
      if (summary === undefined) throw sidecarError("NOT_FOUND", "Project was not found", true);
      const revId = summary.currentSourceRevisionId;

      const issueRow = this.database
        .prepare<{ payload_json: string }>(
          "SELECT payload_json FROM target_migration_issues WHERE project_id=? AND source_revision_id=? AND issue_id=? AND resolved=0",
        )
        .get(projectId, revId, issueId);
      if (issueRow === undefined) {
        throw sidecarError("NOT_FOUND", "Active migration issue was not found", true);
      }
      const issue = JSON.parse(issueRow.payload_json) as TargetMigrationIssue;

      if (issue.severity === "blocking") {
        if (resolution !== "remove_target") {
          throw sidecarError(
            "VALIDATION_FAILED",
            "Blocking migration issues cannot be resolved by acknowledgment alone; target removal is required",
            false,
          );
        }

        const currentTargetState = this.getTargets(projectId);
        const currentTargets = currentTargetState.targets;

        let newQuestionTargets = [...currentTargets.questionTargets];
        let newDetailedGoals = currentTargets.detailedGoals
          ? [...currentTargets.detailedGoals]
          : undefined;

        const locator = issue.targetLocator;
        if (locator) {
          if (locator.kind === "question_target") {
            if (locator.optionKey !== undefined) {
              newQuestionTargets = newQuestionTargets.filter(
                (t) =>
                  !(
                    t.questionId === locator.questionId &&
                    "optionKey" in t &&
                    t.optionKey === locator.optionKey
                  ),
              );
            } else {
              newQuestionTargets = newQuestionTargets.filter(
                (t) => t.questionId !== locator.questionId,
              );
            }
          } else if (locator.kind === "detailed_goal") {
            if (newDetailedGoals) {
              newDetailedGoals = newDetailedGoals.filter((g) => g.id !== locator.goalId);
            }
          } else if (locator.kind === "semantic_override") {
            this.database
              .prepare("DELETE FROM semantic_overrides WHERE project_id=? AND question_id=?")
              .run(projectId, locator.questionId);
          }
        } else if (issue.questionId) {
          newQuestionTargets = newQuestionTargets.filter((t) => t.questionId !== issue.questionId);
        }

        const nextRevision = currentTargetState.revision + 1;
        const updatedTargets: ProjectTargets = {
          ...currentTargets,
          questionTargets: newQuestionTargets,
          ...(newDetailedGoals !== undefined ? { detailedGoals: newDetailedGoals } : {}),
        };

        this.database
          .prepare(
            "INSERT INTO target_revisions (project_id, revision, payload_json, created_at) VALUES (?,?,?,?)",
          )
          .run(projectId, nextRevision, JSON.stringify(updatedTargets), new Date().toISOString());

        this.database
          .prepare(
            "UPDATE target_migration_issues SET resolved=1 WHERE project_id=? AND source_revision_id=? AND issue_id=?",
          )
          .run(projectId, revId, issueId);
      } else {
        this.database
          .prepare(
            "UPDATE target_migration_issues SET resolved=1 WHERE project_id=? AND source_revision_id=? AND issue_id=?",
          )
          .run(projectId, revId, issueId);
      }
    });
  }

  public getSemanticOverrides(projectId: ProjectId): DomainSemanticOverride[] {
    return this.database
      .prepare<{ question_id: string; semantic_type: string; updated_at: string }>(
        "SELECT question_id, semantic_type, updated_at FROM semantic_overrides WHERE project_id=? ORDER BY question_id",
      )
      .all(projectId)
      .map((row) => ({
        questionId: row.question_id as QuestionId,
        value: row.semantic_type,
        updatedAt: row.updated_at,
      }));
  }

  public setSemanticOverride(
    projectId: ProjectId,
    questionId: QuestionId,
    semanticType: string,
  ): void {
    this.database
      .prepare(
        "INSERT INTO semantic_overrides (project_id, question_id, semantic_type, updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id, question_id) DO UPDATE SET semantic_type=excluded.semantic_type, updated_at=excluded.updated_at",
      )
      .run(projectId, questionId, semanticType, new Date().toISOString());
  }

  public createSourceRevision(input: {
    readonly projectId: ProjectId;
    readonly form: FormSnapshot;
    readonly responses: readonly NormalizedResponse[];
    readonly previousRevisionId: SourceRevisionId;
    readonly targetRevision: number;
    readonly targets: ProjectTargets;
    readonly issues: readonly TargetMigrationIssue[];
    readonly importedAt?: string;
  }): { readonly revisionId: SourceRevisionId; readonly targetRevision: number } {
    const revisionId = randomUUID() as SourceRevisionId;
    const snapshotId = randomUUID();
    const importedAt = input.importedAt ?? new Date().toISOString();
    const profiles = profileForm(input.form, input.responses);
    const relationships = analyzeRelationships(input.form, input.responses);

    return this.database.transaction(() => {
      this.database
        .prepare(`INSERT INTO form_snapshots VALUES (@id,@formId,@schemaHash,@capturedAt,@payload)`)
        .run({
          id: snapshotId,
          formId: input.form.formId,
          schemaHash: input.form.schemaHash,
          capturedAt: input.form.capturedAt,
          payload: JSON.stringify(input.form),
        });

      this.database
        .prepare(
          `INSERT INTO source_revisions VALUES (@id,@projectId,@formSnapshotId,@sourceResponseCount,@responseSetHash,@schemaHash,@capturedAt,@importedAt,@previousRevisionId)`,
        )
        .run({
          id: revisionId,
          projectId: input.projectId,
          formSnapshotId: snapshotId,
          sourceResponseCount: input.responses.length,
          responseSetHash: hash(
            [...input.responses]
              .map((response) => ({
                id: response.responseId,
                contentHash: responseContentHash(response),
              }))
              .sort((a, b) => String(a.id).localeCompare(String(b.id))),
          ),
          schemaHash: input.form.schemaHash,
          capturedAt: input.form.capturedAt,
          importedAt,
          previousRevisionId: input.previousRevisionId,
        });

      const versionInsert = this.database.prepare(
        `INSERT OR IGNORE INTO response_versions (id,response_id,created_at,last_submitted_at,content_hash,origin,path_json) VALUES (@id,@responseId,@createdAt,@lastSubmittedAt,@contentHash,'original',@path)`,
      );
      const versionMembershipInsert = this.database.prepare(
        `INSERT OR IGNORE INTO revision_response_versions VALUES (?,?)`,
      );
      const versionAnswerInsert = this.database.prepare(
        `INSERT OR IGNORE INTO response_version_answers VALUES (?,?,?)`,
      );

      const responseInsert = this.database.prepare(
        `INSERT OR IGNORE INTO responses (id,created_at,last_submitted_at,content_hash,origin,path_json) VALUES (@id,@createdAt,@lastSubmittedAt,@contentHash,'original',@path)`,
      );
      const membershipInsert = this.database.prepare(
        `INSERT OR IGNORE INTO revision_responses VALUES (?,?)`,
      );
      const answerInsert = this.database.prepare(`INSERT OR IGNORE INTO answers VALUES (?,?,?)`);

      for (const response of input.responses) {
        const contentHash = responseContentHash(response);
        const versionId = `${response.responseId}:${contentHash}`;

        responseInsert.run({
          id: response.responseId,
          createdAt: response.createdAt ?? null,
          lastSubmittedAt: response.lastSubmittedAt ?? null,
          contentHash,
          path: JSON.stringify(response.path),
        });
        membershipInsert.run(revisionId, response.responseId);
        for (const [questionId, slot] of Object.entries(response.answers))
          answerInsert.run(response.responseId, questionId, JSON.stringify(slot));

        versionInsert.run({
          id: versionId,
          responseId: response.responseId,
          createdAt: response.createdAt ?? null,
          lastSubmittedAt: response.lastSubmittedAt ?? null,
          contentHash,
          path: JSON.stringify(response.path),
        });
        versionMembershipInsert.run(revisionId, versionId);
        for (const [questionId, slot] of Object.entries(response.answers))
          versionAnswerInsert.run(versionId, questionId, JSON.stringify(slot));
      }

      const profileInsert = this.database.prepare(`INSERT INTO question_profiles VALUES (?,?,?,?)`);
      for (const profile of profiles) {
        profileInsert.run(
          revisionId,
          profile.questionId,
          VERSIONS.profilerVersion,
          JSON.stringify(profile),
        );
      }

      const relationshipInsert = this.database.prepare(
        `INSERT INTO relationship_profiles VALUES (?,?,?,?,?)`,
      );
      for (const relationship of relationships) {
        relationshipInsert.run(
          revisionId,
          relationship.questionA,
          relationship.questionB,
          VERSIONS.profilerVersion,
          JSON.stringify(relationship),
        );
      }

      this.database
        .prepare(
          "INSERT INTO target_revisions (project_id, revision, payload_json, created_at) VALUES (?,?,?,?)",
        )
        .run(input.projectId, input.targetRevision, JSON.stringify(input.targets), importedAt);

      const issueInsert = this.database.prepare(
        "INSERT INTO target_migration_issues (project_id, source_revision_id, issue_id, payload_json, resolved) VALUES (?,?,?,?,0)",
      );
      for (const issue of input.issues) {
        issueInsert.run(input.projectId, revisionId, issue.id, JSON.stringify(issue));
      }

      this.database
        .prepare(
          "UPDATE projects SET name=?, current_source_revision_id=?, updated_at=? WHERE id=?",
        )
        .run(input.form.title, revisionId, importedAt, input.projectId);

      return { revisionId, targetRevision: input.targetRevision };
    });
  }

  public saveRun(input: {
    readonly projectId: ProjectId;
    readonly sourceRevisionId: SourceRevisionId;
    readonly targets: ProjectTargets;
    readonly seed: number;
    readonly synthetic: readonly NormalizedResponse[];
    readonly validation: ValidationResult;
    readonly targetRevision: number;
    readonly createdAt?: string;
    readonly semanticOverrides?: readonly DomainSemanticOverride[];
  }): SynthesisRun {
    if (!input.validation.valid) throw new Error("Invalid synthesis Run cannot be persisted");
    const sourceRow = this.database
      .prepare<{ source_response_count: number }>(
        "SELECT source_response_count FROM source_revisions WHERE id=? AND project_id=?",
      )
      .get(input.sourceRevisionId, input.projectId);
    if (sourceRow === undefined) {
      throw sidecarError("NOT_FOUND", "Source revision was not found", false);
    }
    if (
      sourceRow.source_response_count + input.synthetic.length !==
      input.validation.finalResponseCount
    ) {
      throw sidecarError(
        "VALIDATION_FAILED",
        `Run response count mismatch: expected ${input.validation.finalResponseCount}, found ${sourceRow.source_response_count + input.synthetic.length}`,
        false,
      );
    }
    const id = randomUUID() as RunId;
    const targetSnapshotId = randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const semanticOverrides = input.semanticOverrides ?? this.getSemanticOverrides(input.projectId);
    const run: SynthesisRun = {
      id,
      projectId: input.projectId,
      sourceRevisionId: input.sourceRevisionId,
      targetSnapshot: input.targets,
      targetRevision: input.targetRevision,
      seed: input.seed,
      engineVersion: VERSIONS.engineVersion,
      profilerVersion: VERSIONS.profilerVersion,
      appVersion: VERSIONS.appVersion,
      createdAt,
    };
    this.database.transaction(() => {
      this.database
        .prepare("INSERT INTO target_snapshots VALUES (?,?,?,?)")
        .run(targetSnapshotId, input.projectId, JSON.stringify(input.targets), createdAt);
      this.database
        .prepare(
          "INSERT INTO synthesis_runs (id,project_id,source_revision_id,target_snapshot_id,seed,engine_version,profiler_version,app_version,created_at,validation_json,target_revision,semantic_overrides_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.projectId,
          input.sourceRevisionId,
          targetSnapshotId,
          input.seed,
          run.engineVersion,
          run.profilerVersion,
          run.appVersion,
          createdAt,
          JSON.stringify(input.validation),
          input.targetRevision,
          JSON.stringify(semanticOverrides),
        );
      const insert = this.database.prepare(
        "INSERT INTO synthetic_responses (run_id,response_id,payload_json,synthetic_index) VALUES (?,?,?,?)",
      );
      input.synthetic.forEach((response, syntheticIndex) => {
        insert.run(id, response.responseId, JSON.stringify(response), syntheticIndex);
      });
    });
    return run;
  }

  public getRun(id: RunId): {
    runId: string;
    projectId: string;
    sourceRevisionId: string;
    targetSnapshot: ProjectTargets;
    targetRevision: number;
    appVersion: string;
    validation: ValidationResult;
    finalResponseCount: number;
    aiMetadata?: AiMetadata;
  } | null {
    const row = this.database
      .prepare<{
        id: string;
        project_id: string;
        source_revision_id: string;
        payload_json: string;
        validation_json: string;
        target_revision: number;
        app_version: string;
      }>(
        "SELECT sr.id, sr.project_id, sr.source_revision_id, ts.payload_json, sr.validation_json, sr.target_revision, sr.app_version FROM synthesis_runs sr JOIN target_snapshots ts ON ts.id=sr.target_snapshot_id WHERE sr.id=?",
      )
      .get(id);
    if (row === undefined) return null;
    const validation = JSON.parse(row.validation_json) as ValidationResult;
    const aiMetadata = this.getRunAiMetadata(id);
    return {
      runId: row.id,
      projectId: row.project_id,
      sourceRevisionId: row.source_revision_id,
      targetSnapshot: JSON.parse(row.payload_json) as ProjectTargets,
      targetRevision: row.target_revision,
      appVersion: row.app_version,
      validation,
      finalResponseCount: validation.finalResponseCount,
      aiMetadata: aiMetadata ?? undefined,
    };
  }

  public loadHistoricalRunExportData(id: RunId): HistoricalRunExportData {
    const runRow = this.database
      .prepare<{
        id: string;
        project_id: string;
        source_revision_id: string;
        payload_json: string;
        validation_json: string;
        target_revision: number;
        seed: number;
        engine_version: number;
        profiler_version: number;
        app_version: string;
        created_at: string;
        semantic_overrides_json: string | null;
      }>(
        "SELECT sr.id, sr.project_id, sr.source_revision_id, ts.payload_json, sr.validation_json, sr.target_revision, sr.seed, sr.engine_version, sr.profiler_version, sr.app_version, sr.created_at, sr.semantic_overrides_json FROM synthesis_runs sr JOIN target_snapshots ts ON ts.id=sr.target_snapshot_id AND ts.project_id=sr.project_id WHERE sr.id=?",
      )
      .get(id);
    if (runRow === undefined) {
      throw sidecarError("NOT_FOUND", "Run was not found", true);
    }

    const validationValue = parseStoredJson<unknown>(
      runRow.validation_json,
      "Persisted Run validation is corrupt",
    );
    if (!isPersistedValidation(validationValue) || !validationValue.valid) {
      throw sidecarError("VALIDATION_FAILED", "Invalid synthesis Run cannot be exported", false);
    }
    const validation = validationValue;

    const projectRow = this.database
      .prepare<{ time_zone: string | null }>("SELECT time_zone FROM projects WHERE id=?")
      .get(runRow.project_id);
    if (projectRow === undefined) {
      throw sidecarError("NOT_FOUND", "Project was not found", true);
    }
    const timeZone = resolveHistoricalProjectTimeZone(id, projectRow.time_zone);

    const revisionId = runRow.source_revision_id as SourceRevisionId;
    const snapshot = this.database
      .prepare<{ payload_json: string }>(
        "SELECT fs.payload_json FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=? AND sr.project_id=?",
      )
      .get(revisionId, runRow.project_id);
    if (snapshot === undefined) {
      throw sidecarError("NOT_FOUND", "Historical Form snapshot was not found", false);
    }
    const formValue = parseStoredJson<unknown>(snapshot.payload_json, "Form snapshot is corrupt");
    if (!isPersistedFormSnapshot(formValue)) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Form snapshot is corrupt", false);
    }
    const form = formValue;
    const originalResponses = this.loadRevisionResponses(
      revisionId,
      form,
      runRow.project_id as ProjectId,
    );
    const semanticInferences = this.database
      .prepare<{ question_id: string; payload_json: string }>(
        "SELECT question_id, payload_json FROM question_profiles WHERE revision_id=? ORDER BY question_id",
      )
      .all(revisionId)
      .flatMap((row) => {
        const profile = parseStoredJson<unknown>(
          row.payload_json,
          "Historical question profile is corrupt",
        );
        if (!isRecord(profile)) {
          throw sidecarError(
            "BACKEND_UNAVAILABLE",
            "Historical question profile is corrupt",
            false,
          );
        }
        const semanticInference = profile.semanticInference;
        if (
          semanticInference !== undefined &&
          (!isRecord(semanticInference) || typeof semanticInference.inferred !== "string")
        ) {
          throw sidecarError(
            "BACKEND_UNAVAILABLE",
            "Historical question profile is corrupt",
            false,
          );
        }
        const inferred =
          isRecord(semanticInference) && typeof semanticInference.inferred === "string"
            ? semanticInference.inferred
            : undefined;
        return inferred === undefined
          ? []
          : [{ questionId: row.question_id as QuestionId, value: inferred }];
      });

    const syntheticRows = this.database
      .prepare<{ response_id: string; payload_json: string; synthetic_index: number }>(
        "SELECT response_id, payload_json, synthetic_index FROM synthetic_responses WHERE run_id=? ORDER BY synthetic_index ASC",
      )
      .all(runRow.id);
    if (syntheticRows.some((row, index) => row.synthetic_index !== index)) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Synthetic response ordering is corrupt", false);
    }
    const aiTexts = this.getRunAiTexts(runRow.id as RunId);
    const syntheticResponses: NormalizedResponse[] = syntheticRows.map((row) => {
      const resp = parseStoredSyntheticResponse(row.payload_json, row.response_id);
      if (aiTexts.size === 0) return resp;
      let hasOverlay = false;
      const answers = { ...resp.answers };
      for (const [qId, slot] of Object.entries(answers)) {
        const key = `${resp.responseId}:${qId}`;
        const text = aiTexts.get(key);
        if (text !== undefined && slot.state === "answered" && slot.value.kind === "text") {
          answers[qId as QuestionId] = {
            state: "answered",
            value: { kind: "text", value: text },
          };
          hasOverlay = true;
        }
      }
      return hasOverlay ? { ...resp, answers } : resp;
    });

    if (originalResponses.length + syntheticResponses.length !== validation.finalResponseCount) {
      throw sidecarError(
        "INTERNAL",
        `Persisted Run response count mismatch: expected ${validation.finalResponseCount}, found ${originalResponses.length + syntheticResponses.length}`,
        false,
      );
    }

    const semanticOverridesJson = runRow.semantic_overrides_json;
    const frozenSemanticOverridesJson =
      semanticOverridesJson ??
      throwLegacyCompatibilityRequired(
        legacyCompatibilityRequired(id, "missing_semantic_override_snapshot"),
      );
    const semanticOverrides = parseStoredJson<DomainSemanticOverride[]>(
      frozenSemanticOverridesJson,
      "Persisted Run semantic overrides are corrupt",
    );
    if (
      !Array.isArray(semanticOverrides) ||
      semanticOverrides.some(
        (override) =>
          typeof override !== "object" ||
          override === null ||
          typeof override.questionId !== "string" ||
          typeof override.value !== "string" ||
          typeof override.updatedAt !== "string",
      )
    ) {
      throw sidecarError(
        "BACKEND_UNAVAILABLE",
        "Persisted Run semantic overrides are corrupt",
        false,
      );
    }

    const targetSnapshotValue = parseStoredJson<unknown>(
      runRow.payload_json,
      "Persisted Run target snapshot is corrupt",
    );
    if (!isPersistedTargetSnapshot(targetSnapshotValue)) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Persisted Run target snapshot is corrupt", false);
    }

    return {
      run: {
        id: runRow.id as RunId,
        projectId: runRow.project_id as ProjectId,
        sourceRevisionId: revisionId,
        targetSnapshot: targetSnapshotValue,
        targetRevision: runRow.target_revision,
        seed: runRow.seed,
        engineVersion: runRow.engine_version,
        profilerVersion: runRow.profiler_version,
        appVersion: runRow.app_version,
        createdAt: runRow.created_at,
        validation,
        finalResponseCount: validation.finalResponseCount,
      },
      form,
      originalResponses,
      syntheticResponses,
      timeZone,
      semanticInferences,
      semanticOverrides,
    };
  }

  public delete(id: ProjectId): void {
    this.database.transaction(() => {
      this.database.prepare(`DELETE FROM target_migration_issues WHERE project_id=?`).run(id);
      this.database.prepare(`DELETE FROM semantic_overrides WHERE project_id=?`).run(id);
      this.database.prepare(`DELETE FROM projects WHERE id=?`).run(id);
      this.database
        .prepare(
          `DELETE FROM responses WHERE origin='original' AND NOT EXISTS (SELECT 1 FROM revision_responses rr WHERE rr.response_id=responses.id)`,
        )
        .run();
      this.database
        .prepare(
          `DELETE FROM response_versions WHERE origin='original' AND NOT EXISTS (SELECT 1 FROM revision_response_versions rrv WHERE rrv.response_version_id=response_versions.id)`,
        )
        .run();
    });
  }

  public getRunAiMetadata(id: RunId): AiMetadata | null {
    const row = this.database
      .prepare<{
        provider: string;
        model: string;
        prompt_version: number;
        settings_hash: string;
        status: string;
        item_count: number;
        generated_count: number;
        failed_count: number;
        generated_at: string;
        warnings_json: string;
      }>(
        "SELECT provider, model, prompt_version, settings_hash, status, item_count, generated_count, failed_count, generated_at, warnings_json FROM run_ai_metadata WHERE run_id=?",
      )
      .get(id);
    if (row === undefined) return null;
    let warnings: string[] = [];
    try {
      warnings = JSON.parse(row.warnings_json) as string[];
    } catch {
      // ignore
    }
    return {
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      settingsHash: row.settings_hash,
      status: row.status as "completed" | "partial" | "failed",
      itemCount: row.item_count,
      generatedCount: row.generated_count,
      failedCount: row.failed_count,
      generatedAt: row.generated_at,
      warnings,
    };
  }

  public getRunAiTexts(id: RunId): Map<string, string> {
    const rows = this.database
      .prepare<{ response_id: string; question_id: string; text: string }>(
        "SELECT response_id, question_id, text FROM run_ai_texts WHERE run_id=?",
      )
      .all(id);
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(`${row.response_id}:${row.question_id}`, row.text);
    }
    return map;
  }

  public saveRunAiOverlay(input: {
    readonly runId: RunId;
    readonly metadata: AiMetadata;
    readonly texts: ReadonlyMap<string, string>;
  }): void {
    const runExists = this.database
      .prepare("SELECT 1 FROM synthesis_runs WHERE id=?")
      .get(input.runId);
    if (runExists === undefined) {
      throw sidecarError("NOT_FOUND", "Run was not found", true);
    }
    this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT OR REPLACE INTO run_ai_metadata (run_id, provider, model, prompt_version, settings_hash, status, item_count, generated_count, failed_count, generated_at, warnings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.runId,
          input.metadata.provider,
          input.metadata.model,
          input.metadata.promptVersion,
          input.metadata.settingsHash,
          input.metadata.status,
          input.metadata.itemCount,
          input.metadata.generatedCount,
          input.metadata.failedCount,
          input.metadata.generatedAt,
          JSON.stringify(input.metadata.warnings ?? []),
        );

      const insertText = this.database.prepare(
        "INSERT OR REPLACE INTO run_ai_texts (run_id, response_id, question_id, text) VALUES (?, ?, ?, ?)",
      );
      for (const [key, text] of input.texts.entries()) {
        const colonIndex = key.indexOf(":");
        if (colonIndex !== -1) {
          const responseId = key.substring(0, colonIndex);
          const questionId = key.substring(colonIndex + 1);
          insertText.run(input.runId, responseId, questionId, text);
        }
      }
    });
  }

  public loadRunDataForAi(id: RunId): {
    readonly runId: RunId;
    readonly projectId: ProjectId;
    readonly form: FormSnapshot;
    readonly originalResponses: readonly NormalizedResponse[];
    readonly syntheticResponses: readonly NormalizedResponse[];
    readonly semanticInferences: readonly {
      questionId: QuestionId;
      inference: SemanticInference;
    }[];
    readonly semanticOverrides: readonly DomainSemanticOverride[];
  } {
    const runRow = this.database
      .prepare<{
        id: string;
        project_id: string;
        source_revision_id: string;
        semantic_overrides_json: string | null;
      }>(
        "SELECT id, project_id, source_revision_id, semantic_overrides_json FROM synthesis_runs WHERE id=?",
      )
      .get(id);
    if (runRow === undefined) {
      throw sidecarError("NOT_FOUND", "Run was not found", true);
    }
    const revisionId = runRow.source_revision_id as SourceRevisionId;
    const snapshot = this.database
      .prepare<{ payload_json: string }>(
        "SELECT fs.payload_json FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=? AND sr.project_id=?",
      )
      .get(revisionId, runRow.project_id);
    if (snapshot === undefined) {
      throw sidecarError("NOT_FOUND", "Historical Form snapshot was not found", false);
    }
    const form = parseStoredJson<FormSnapshot>(snapshot.payload_json, "Form snapshot is corrupt");
    const originalResponses = this.loadRevisionResponses(
      revisionId,
      form,
      runRow.project_id as ProjectId,
    );

    const syntheticRows = this.database
      .prepare<{ response_id: string; payload_json: string; synthetic_index: number }>(
        "SELECT response_id, payload_json, synthetic_index FROM synthetic_responses WHERE run_id=? ORDER BY synthetic_index ASC",
      )
      .all(runRow.id);
    const syntheticResponses: NormalizedResponse[] = syntheticRows.map((row) =>
      parseStoredSyntheticResponse(row.payload_json, row.response_id),
    );

    const semanticInferences: { questionId: QuestionId; inference: SemanticInference }[] = [];
    const profileRows = this.database
      .prepare<{ question_id: string; payload_json: string }>(
        "SELECT question_id, payload_json FROM question_profiles WHERE revision_id=? ORDER BY question_id",
      )
      .all(revisionId);
    for (const row of profileRows) {
      const profile = parseStoredJson<QuestionProfile>(
        row.payload_json,
        "Historical question profile is corrupt",
      );
      if (profile.semanticInference) {
        semanticInferences.push({
          questionId: row.question_id as QuestionId,
          inference: profile.semanticInference,
        });
      }
    }

    const semanticOverridesJson = runRow.semantic_overrides_json;
    const semanticOverrides: DomainSemanticOverride[] =
      semanticOverridesJson !== null && semanticOverridesJson !== undefined
        ? parseStoredJson<DomainSemanticOverride[]>(
            semanticOverridesJson,
            "Semantic overrides snapshot is corrupt",
          )
        : [];

    return {
      runId: id,
      projectId: runRow.project_id as ProjectId,
      form,
      originalResponses,
      syntheticResponses,
      semanticInferences,
      semanticOverrides,
    };
  }

  public getAppSetting(key: string): string | null {
    const row = this.database
      .prepare<{ value: string }>("SELECT value FROM app_settings WHERE key=?")
      .get(key);
    return row?.value ?? null;
  }

  public setAppSetting(key: string, value: string): void {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
      )
      .run(key, value, updatedAt);
  }
}
