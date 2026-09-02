import { createHash, randomUUID } from "node:crypto";
import type {
  FormSnapshot,
  GoogleAccountId,
  NormalizedResponse,
  ProjectId,
  ProjectSummary,
  SourceRevisionId,
  SynthesisProject,
} from "@survey-synth/domain";
import { VERSIONS } from "@survey-synth/contracts";
import {
  analyzeRelationships,
  profileForm,
  type QuestionProfile,
  type RelationshipProfile,
} from "@survey-synth/statistics";
import { ProjectDatabase } from "./database.js";

export interface CreatedProject {
  readonly project: SynthesisProject;
  readonly profiles: readonly QuestionProfile[];
  readonly relationships: readonly RelationshipProfile[];
}

export interface ProjectDetail extends ProjectSummary {
  readonly profiles: readonly QuestionProfile[];
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
        `SELECT p.id, p.google_account_id AS googleAccountId, p.google_form_id AS googleFormId, p.name, p.current_source_revision_id AS currentSourceRevisionId, p.created_at AS createdAt, p.updated_at AS updatedAt, (SELECT COUNT(*) FROM revision_responses rr WHERE rr.revision_id = p.current_source_revision_id) AS responseCount, (SELECT COUNT(*) FROM form_snapshots fs JOIN source_revisions sr ON sr.form_snapshot_id=fs.id WHERE sr.id=p.current_source_revision_id) AS questionCount, (SELECT COUNT(*) FROM question_profiles qp WHERE qp.revision_id=p.current_source_revision_id) AS profileCount FROM projects p ORDER BY p.updated_at DESC`,
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
    return { ...summary, profiles, relationships };
  }
  public delete(id: ProjectId): void {
    this.database.transaction(() => {
      this.database.prepare(`DELETE FROM projects WHERE id=?`).run(id);
    });
  }
}
