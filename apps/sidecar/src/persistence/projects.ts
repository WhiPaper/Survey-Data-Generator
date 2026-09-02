import { createHash, randomUUID } from "node:crypto";
import type {
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
import { VERSIONS } from "@survey-synth/contracts";
import {
  analyzeRelationships,
  profileForm,
  type QuestionProfile,
  type RelationshipProfile,
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

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

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
        `SELECT p.id, p.google_account_id AS googleAccountId, p.google_form_id AS googleFormId, p.name, p.current_source_revision_id AS currentSourceRevisionId, p.created_at AS createdAt, p.updated_at AS updatedAt, COALESCE((SELECT COUNT(*) FROM revision_response_versions rrv WHERE rrv.revision_id = p.current_source_revision_id), (SELECT COUNT(*) FROM revision_responses rr WHERE rr.revision_id = p.current_source_revision_id), 0) AS responseCount, (SELECT json_array_length(fs.payload_json, '$.questions') FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=p.current_source_revision_id) AS questionCount, (SELECT COUNT(*) FROM question_profiles qp WHERE qp.revision_id=p.current_source_revision_id) AS profileCount FROM projects p ORDER BY p.updated_at DESC`,
      )
      .all();
  }

  public createFromImport(
    accountId: GoogleAccountId,
    form: FormSnapshot,
    responses: readonly NormalizedResponse[],
    importedAt = new Date().toISOString(),
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
      currentSourceRevisionId: revisionId,
      createdAt: now,
      updatedAt: now,
    };
    const profiles = profileForm(form, responses);
    const relationships = analyzeRelationships(form, responses);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects VALUES (@id,@googleAccountId,@googleFormId,@name,@currentSourceRevisionId,@createdAt,@updatedAt)`,
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
    const form = JSON.parse(snapshot.payload_json) as FormSnapshot;

    const versionRows = this.database
      .prepare<{
        id: string;
        created_at: string | null;
        last_submitted_at: string | null;
        path_json: string;
        version_id: string;
      }>(
        "SELECT rv.response_id AS id, rv.created_at, rv.last_submitted_at, rv.path_json, rrv.response_version_id AS version_id FROM response_versions rv JOIN revision_response_versions rrv ON rrv.response_version_id=rv.id WHERE rrv.revision_id=? ORDER BY rv.response_id",
      )
      .all(revisionId);

    let responses: NormalizedResponse[];
    if (versionRows.length > 0) {
      const answers = this.database.prepare<{ question_id: string; slot_json: string }>(
        "SELECT question_id, slot_json FROM response_version_answers WHERE version_id=?",
      );
      responses = versionRows.map((row) => {
        const responseAnswers = Object.fromEntries(
          answers
            .all(row.version_id)
            .map((answer) => [answer.question_id, JSON.parse(answer.slot_json)]),
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
              : JSON.parse(row.path_json),
        };
      });
    } else {
      const rows = this.database
        .prepare<{
          id: string;
          created_at: string | null;
          last_submitted_at: string | null;
          path_json: string;
        }>(
          "SELECT r.id, r.created_at, r.last_submitted_at, r.path_json FROM responses r JOIN revision_responses rr ON rr.response_id=r.id WHERE rr.revision_id=? ORDER BY r.id",
        )
        .all(revisionId);
      const answers = this.database.prepare<{ question_id: string; slot_json: string }>(
        "SELECT question_id, slot_json FROM answers WHERE response_id=?",
      );
      responses = rows.map((row) => {
        const responseAnswers = Object.fromEntries(
          answers.all(row.id).map((answer) => [answer.question_id, JSON.parse(answer.slot_json)]),
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
              : JSON.parse(row.path_json),
        };
      });
    }

    const relationships = this.database
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM relationship_profiles WHERE revision_id=? ORDER BY question_a, question_b",
      )
      .all(revisionId)
      .map((row) => JSON.parse(row.payload_json) as RelationshipProfile);
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
  }): SynthesisRun {
    if (!input.validation.valid) throw new Error("Invalid synthesis Run cannot be persisted");
    const id = randomUUID() as RunId;
    const targetSnapshotId = randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
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
          "INSERT INTO synthesis_runs (id,project_id,source_revision_id,target_snapshot_id,seed,engine_version,profiler_version,app_version,created_at,validation_json,target_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
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
        );
      const insert = this.database.prepare("INSERT INTO synthetic_responses VALUES (?,?,?)");
      for (const response of input.synthetic)
        insert.run(id, response.responseId, JSON.stringify(response));
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
    return {
      runId: row.id,
      projectId: row.project_id,
      sourceRevisionId: row.source_revision_id,
      targetSnapshot: JSON.parse(row.payload_json) as ProjectTargets,
      targetRevision: row.target_revision,
      appVersion: row.app_version,
      validation,
      finalResponseCount: validation.finalResponseCount,
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
}
