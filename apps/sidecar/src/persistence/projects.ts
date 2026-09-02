import { createHash, randomUUID } from "node:crypto";
import type {
  FormSnapshot,
  GoogleAccountId,
  NormalizedResponse,
  ProjectId,
  ProjectTargets,
  RunId,
  ProjectSummary,
  SourceRevisionId,
  SynthesisProject,
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
}

export interface SynthesisSource {
  readonly form: FormSnapshot;
  readonly responses: readonly NormalizedResponse[];
  readonly sourceRevisionId: SourceRevisionId;
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
        `SELECT p.id, p.google_account_id AS googleAccountId, p.google_form_id AS googleFormId, p.name, p.current_source_revision_id AS currentSourceRevisionId, p.created_at AS createdAt, p.updated_at AS updatedAt, (SELECT COUNT(*) FROM revision_responses rr WHERE rr.revision_id = p.current_source_revision_id) AS responseCount, (SELECT json_array_length(fs.payload_json, '$.questions') FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=p.current_source_revision_id) AS questionCount, (SELECT COUNT(*) FROM question_profiles qp WHERE qp.revision_id=p.current_source_revision_id) AS profileCount FROM projects p ORDER BY p.updated_at DESC`,
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
        `INSERT INTO responses VALUES (@id,@createdAt,@lastSubmittedAt,@contentHash,'original')`,
      );
      const membershipInsert = this.database.prepare(`INSERT INTO revision_responses VALUES (?,?)`);
      const answerInsert = this.database.prepare(`INSERT INTO answers VALUES (?,?,?)`);
      for (const response of responses) {
        responseInsert.run({
          id: response.responseId,
          createdAt: response.createdAt ?? null,
          lastSubmittedAt: response.lastSubmittedAt ?? null,
          contentHash: responseContentHash(response),
        });
        membershipInsert.run(revisionId, response.responseId);
        for (const [questionId, slot] of Object.entries(response.answers))
          answerInsert.run(response.responseId, questionId, JSON.stringify(slot));
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
    return {
      ...summary,
      form: JSON.parse(formRow.payload_json) as FormSnapshot,
      targets: targetState.targets,
      targetRevision: targetState.revision,
      profiles,
      relationships,
    };
  }

  public getTargets(id: ProjectId): { revision: number; targets: ProjectTargets } {
    const row = this.database
      .prepare<{ revision: number; payload_json: string }>(
        "SELECT revision, payload_json FROM target_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(id);
    if (row !== undefined)
      return { revision: row.revision, targets: JSON.parse(row.payload_json) as ProjectTargets };
    const project = this.list().find((item) => item.id === id);
    if (project === undefined) throw sidecarError("NOT_FOUND", "Project was not found", true);
    return {
      revision: 0,
      targets: { targetResponseCount: project.responseCount, questionTargets: [] },
    };
  }

  public updateTargets(
    id: ProjectId,
    expectedRevision: number,
    targets: ProjectTargets,
  ): { revision: number; targets: ProjectTargets } {
    return this.database.transaction(() => {
      const current = this.getTargets(id);
      if (current.revision !== expectedRevision)
        throw sidecarError("TARGET_CONFLICT", "Target revision is out of date", true);
      if (JSON.stringify(current.targets) === JSON.stringify(targets)) return current;
      const next = { revision: current.revision + 1, targets };
      this.database
        .prepare(
          "INSERT INTO target_revisions (project_id, revision, payload_json, created_at) VALUES (?,?,?,?)",
        )
        .run(id, next.revision, JSON.stringify(targets), new Date().toISOString());
      return next;
    });
  }

  public loadSynthesisSource(id: ProjectId): SynthesisSource | null {
    const summary = this.list().find((project) => project.id === id);
    if (summary === undefined) return null;
    const snapshot = this.database
      .prepare<{ payload_json: string }>(
        "SELECT fs.payload_json FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=?",
      )
      .get(summary.currentSourceRevisionId);
    if (snapshot === undefined) return null;
    const form = JSON.parse(snapshot.payload_json) as FormSnapshot;
    const rows = this.database
      .prepare<{ id: string; created_at: string | null; last_submitted_at: string | null }>(
        "SELECT r.id, r.created_at, r.last_submitted_at FROM responses r JOIN revision_responses rr ON rr.response_id=r.id WHERE rr.revision_id=? ORDER BY r.id",
      )
      .all(summary.currentSourceRevisionId);
    const answers = this.database.prepare<{ question_id: string; slot_json: string }>(
      "SELECT question_id, slot_json FROM answers WHERE response_id=?",
    );
    const responses = rows.map((row) => {
      const responseAnswers = Object.fromEntries(
        answers.all(row.id).map((answer) => [answer.question_id, JSON.parse(answer.slot_json)]),
      ) as NormalizedResponse["answers"];
      return {
        responseId: row.id as never,
        createdAt: row.created_at ?? undefined,
        lastSubmittedAt: row.last_submitted_at ?? undefined,
        answers: responseAnswers,
        origin: "original" as const,
        path: resolveResponsePath(form, responseAnswers),
      };
    });
    return { form, responses, sourceRevisionId: summary.currentSourceRevisionId };
  }

  public saveRun(input: {
    readonly projectId: ProjectId;
    readonly sourceRevisionId: SourceRevisionId;
    readonly targets: ProjectTargets;
    readonly seed: number;
    readonly synthetic: readonly NormalizedResponse[];
    readonly validation: ValidationResult;
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
      seed: input.seed,
      engineVersion: VERSIONS.engineVersion,
      profilerVersion: VERSIONS.profilerVersion,
      createdAt,
    };
    this.database.transaction(() => {
      this.database
        .prepare("INSERT INTO target_snapshots VALUES (?,?,?,?)")
        .run(targetSnapshotId, input.projectId, JSON.stringify(input.targets), createdAt);
      this.database
        .prepare("INSERT INTO synthesis_runs VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          input.projectId,
          input.sourceRevisionId,
          targetSnapshotId,
          input.seed,
          run.engineVersion,
          run.profilerVersion,
          createdAt,
          JSON.stringify(input.validation),
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
      }>(
        "SELECT sr.id, sr.project_id, sr.source_revision_id, ts.payload_json, sr.validation_json FROM synthesis_runs sr JOIN target_snapshots ts ON ts.id=sr.target_snapshot_id WHERE sr.id=?",
      )
      .get(id);
    if (row === undefined) return null;
    const validation = JSON.parse(row.validation_json) as ValidationResult;
    return {
      runId: row.id,
      projectId: row.project_id,
      sourceRevisionId: row.source_revision_id,
      targetSnapshot: JSON.parse(row.payload_json) as ProjectTargets,
      validation,
      finalResponseCount: validation.finalResponseCount,
    };
  }

  public delete(id: ProjectId): void {
    this.database.transaction(() => {
      this.database.prepare(`DELETE FROM projects WHERE id=?`).run(id);
    });
  }
}
