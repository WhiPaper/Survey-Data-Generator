import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SecureSecretStore } from "../src/host.js";
import { ProjectDatabase } from "../src/persistence/database.js";
import { ProjectRepository } from "../src/persistence/projects.js";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";
import { synthesize } from "@survey-synth/synthesis-core";

class TestSecrets implements SecureSecretStore {
  public readonly values = new Map<string, Uint8Array>();
  public get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  public set(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe("encrypted project database", () => {
  it("creates, writes, reopens, and rejects a wrong key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-db-"));
    const path = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const first = await ProjectDatabase.open(path, secrets);
    first
      .prepare(
        "INSERT INTO projects (id,google_account_id,google_form_id,name,current_source_revision_id,created_at,updated_at) VALUES ('p','a','f','marker','r','now','now')",
      )
      .run();
    first.close();
    const raw = await readFile(path);
    expect(raw.includes(Buffer.from("marker"))).toBe(false);
    const reopened = await ProjectDatabase.open(path, secrets);
    expect(
      reopened.prepare<{ name: string }>("SELECT name FROM projects WHERE id='p'").get(),
    ).toEqual({ name: "marker" });
    expect(reopened.prepare<{ user_version: number }>("PRAGMA user_version").get()).toEqual({
      user_version: 10,
    });
    reopened.close();
    const wrong = new TestSecrets();
    wrong.values.set("survey-synth:database-key", new Uint8Array(32).fill(7));
    await expect(ProjectDatabase.open(path, wrong)).rejects.toMatchObject({
      backendError: { code: "BACKEND_UNAVAILABLE" },
    });
  });

  it("migrates schema 4 Runs to frozen target revisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-migration-"));
    const path = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const previous = await ProjectDatabase.open(path, secrets);
    previous.prepare("ALTER TABLE synthesis_runs DROP COLUMN target_revision").run();
    previous.prepare("PRAGMA user_version = 4").run();
    previous.close();

    const migrated = await ProjectDatabase.open(path, secrets);
    const columns = migrated
      .prepare<{ name: string }>("PRAGMA table_info(synthesis_runs)")
      .all()
      .map((column) => column.name);
    expect(columns).toContain("target_revision");
    expect(migrated.prepare<{ user_version: number }>("PRAGMA user_version").get()).toEqual({
      user_version: 10,
    });
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("adds the v8 timezone column without rebuilding existing v7 project rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-v8-timezone-"));
    const path = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const previous = await ProjectDatabase.open(path, secrets);
    previous
      .prepare(
        "INSERT INTO projects (id,google_account_id,google_form_id,name,current_source_revision_id,created_at,updated_at) VALUES ('p-v7','acc','form','V7 Project','rev','2026-01-01','2026-01-01')",
      )
      .run();
    previous.prepare("ALTER TABLE projects DROP COLUMN time_zone").run();
    previous.prepare("PRAGMA user_version = 7").run();
    previous.close();

    const migrated = await ProjectDatabase.open(path, secrets);
    const project = migrated
      .prepare<{ name: string; time_zone: string | null }>(
        "SELECT name, time_zone FROM projects WHERE id='p-v7'",
      )
      .get();
    expect(project).toEqual({ name: "V7 Project", time_zone: null });
    expect(migrated.prepare<{ user_version: number }>("PRAGMA user_version").get()).toEqual({
      user_version: 10,
    });
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("does not create a replacement database when the key is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-db-"));
    const path = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(path, secrets);
    db.close();
    await expect(ProjectDatabase.open(path, new TestSecrets())).rejects.toMatchObject({
      backendError: { code: "BACKEND_UNAVAILABLE" },
    });
  });

  it("creates a coherent local project with normalized answers and derived data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-db-"));
    const databasePath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    let db = await ProjectDatabase.open(databasePath, secrets);
    const form: FormSnapshot = {
      formId: "form" as never,
      title: "Local form",
      capturedAt: "now",
      schemaHash: "schema",
      sections: [],
      groups: [],
      logic: {
        entrySectionId: "section" as never,
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
      questions: [
        {
          id: "question" as never,
          title: "Choice",
          sectionId: "section" as never,
          required: false,
          affectsNavigation: false,
          kind: "single_choice",
          presentation: "radio",
          options: [{ key: "yes" as never, label: "Yes" }],
          shuffle: false,
        },
        {
          id: "second-question" as never,
          title: "Second",
          sectionId: "section" as never,
          required: false,
          affectsNavigation: false,
          kind: "text",
          presentation: "short",
        },
      ],
    };
    const responses: NormalizedResponse[] = [
      {
        responseId: "response" as never,
        origin: "original",
        answers: {
          ["question"]: {
            state: "answered",
            value: { kind: "single_choice", optionKey: "yes" as never, label: "Yes" },
          },
        },
        path: {
          questions: { question: "reached", "second-question": "not_reached" } as never,
          confidence: "certain",
        },
      },
    ];
    const repository = new ProjectRepository(db);
    const created = repository.createFromImport("account" as never, form, responses, "imported");
    expect(repository.list()[0]).toMatchObject({
      id: created.project.id,
      responseCount: 1,
      questionCount: 2,
      profileCount: 2,
    });
    expect(repository.get(created.project.id)).toMatchObject({
      name: "Local form",
      profiles: [{ questionKind: "single_choice" }, { questionKind: "text" }],
      relationships: [],
    });
    const expectedPath = responses[0]!.path;
    db.close();
    db = await ProjectDatabase.open(databasePath, secrets);
    const reopenedRepository = new ProjectRepository(db);
    expect(reopenedRepository.loadSynthesisSource(created.project.id)?.responses[0]?.path).toEqual(
      expectedPath,
    );
    db.prepare("DELETE FROM revision_response_versions WHERE revision_id=?").run(
      created.project.currentSourceRevisionId,
    );
    expect(() =>
      reopenedRepository.loadSynthesisSource(
        created.project.id,
        created.project.currentSourceRevisionId,
      ),
    ).toThrow("Source revision response membership is incomplete");
    reopenedRepository.delete(created.project.id);
    expect(reopenedRepository.list()).toHaveLength(0);
    for (const table of [
      "source_revisions",
      "revision_responses",
      "responses",
      "synthesis_runs",
      "synthetic_responses",
    ])
      expect(db.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual(
        { count: 0 },
      );
    db.close();
  });

  it("persists only a validated immutable M4 Run with frozen inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-db-"));
    const db = await ProjectDatabase.open(join(directory, "projects.db"), new TestSecrets());
    const form: FormSnapshot = {
      formId: "form" as never,
      title: "Run form",
      capturedAt: "now",
      schemaHash: "schema",
      sections: [],
      groups: [],
      logic: {
        entrySectionId: "section" as never,
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
      questions: [
        {
          id: "choice" as never,
          title: "Choice",
          sectionId: "section" as never,
          required: false,
          affectsNavigation: false,
          kind: "single_choice",
          presentation: "radio",
          options: [{ key: "yes" as never, label: "Yes" }],
          shuffle: false,
        },
      ],
    };
    const source: NormalizedResponse[] = [
      {
        responseId: "source" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          choice: {
            state: "answered",
            value: { kind: "single_choice", optionKey: "yes" as never, label: "Yes" },
          },
        },
      },
    ];
    const repository = new ProjectRepository(db);
    const project = repository.createFromImport(
      "account" as never,
      form,
      source,
      "imported",
    ).project;
    expect(repository.getTargets(project.id)).toEqual({
      revision: 0,
      targets: { targetResponseCount: 1, questionTargets: [] },
    });
    const firstTargetSave = repository.updateTargets(project.id, 0, {
      targetResponseCount: 2,
      questionTargets: [],
    });
    expect(firstTargetSave.revision).toBe(1);
    expect(repository.updateTargets(project.id, 1, firstTargetSave.targets)).toEqual(
      firstTargetSave,
    );
    expect(() =>
      repository.updateTargets(project.id, 0, { targetResponseCount: 3, questionTargets: [] }),
    ).toThrow();
    const sourceSnapshot = repository.loadSynthesisSource(project.id)!;
    const result = synthesize(
      sourceSnapshot.form,
      sourceSnapshot.responses,
      { targetResponseCount: 2, questionTargets: [] },
      42,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      const run = repository.saveRun({
        projectId: project.id,
        sourceRevisionId: sourceSnapshot.sourceRevisionId,
        targets: { targetResponseCount: 2, questionTargets: [] },
        seed: 42,
        targetRevision: 3,
        synthetic: result.synthetic,
        validation: result.validation!,
      });
      expect(run).toMatchObject({
        sourceRevisionId: sourceSnapshot.sourceRevisionId,
        seed: 42,
        engineVersion: 2,
        appVersion: "0.1.0",
        targetRevision: 3,
      });
      expect(repository.getRun(run.id)).toMatchObject({
        runId: run.id,
        targetSnapshot: { targetResponseCount: 2, questionTargets: [] },
        finalResponseCount: 2,
        targetRevision: 3,
        appVersion: "0.1.0",
      });
      expect(
        db.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM synthesis_runs").get(),
      ).toEqual({ count: 1 });
      expect(
        db.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM synthetic_responses").get(),
      ).toEqual({ count: 1 });
    }
    db.close();
  });

  it("migrates pre-v7 database backfilling response_versions and revision_response_versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-v7-backfill-"));
    const path = join(directory, "projects.db");
    const secrets = new TestSecrets();

    // 1. Create a DB at user_version = 6 with pre-v7 schema
    const rawDb = await ProjectDatabase.open(path, secrets);
    rawDb.transaction(() => {
      // Revert user_version to 6 and drop v7 tables
      rawDb.prepare("DROP TABLE IF EXISTS revision_response_versions").run();
      rawDb.prepare("DROP TABLE IF EXISTS response_version_answers").run();
      rawDb.prepare("DROP TABLE IF EXISTS response_versions").run();
      rawDb.prepare("DROP TABLE IF EXISTS target_migration_issues").run();
      rawDb.prepare("DROP TABLE IF EXISTS semantic_overrides").run();
      rawDb.prepare("PRAGMA user_version = 6").run();

      // Insert mock pre-v7 records
      rawDb
        .prepare(
          "INSERT INTO projects (id,google_account_id,google_form_id,name,current_source_revision_id,created_at,updated_at) VALUES ('p-v6','acc','f1','V6 Project','rev-1','2026-01-01','2026-01-01')",
        )
        .run();
      rawDb
        .prepare(
          'INSERT INTO form_snapshots VALUES (\'snap-1\',\'f1\',\'hash\',\'2026-01-01\',\'{"formId":"f1","title":"V6 Form","schemaHash":"hash","capturedAt":"2026-01-01","sections":[],"questions":[{"id":"q1","title":"Q1","sectionId":"s1","required":false,"affectsNavigation":false,"kind":"single_choice","presentation":"radio","options":[{"key":"opt-1","label":"Yes"}],"shuffle":false}],"groups":[],"logic":{"entrySectionId":"s1","sections":[],"transitions":[],"coverage":"none","hasRestartFlow":false}}\')',
        )
        .run();
      rawDb
        .prepare(
          "INSERT INTO source_revisions VALUES ('rev-1','p-v6','snap-1',1,'hash','hash','2026-01-01','2026-01-01',NULL)",
        )
        .run();
      rawDb
        .prepare(
          "INSERT INTO responses VALUES ('resp-v6','2026-01-01','2026-01-01','hash-v6','original','{}')",
        )
        .run();
      rawDb.prepare("INSERT INTO revision_responses VALUES ('rev-1','resp-v6')").run();
      rawDb
        .prepare(
          'INSERT INTO answers VALUES (\'resp-v6\',\'q1\',\'{"state":"answered","value":{"kind":"single_choice","optionKey":"opt-1","label":"Yes"}}\')',
        )
        .run();
    });
    rawDb.close();

    // 2. Reopen DB - will trigger v7 and v8 migration
    const migratedDb = await ProjectDatabase.open(path, secrets);
    expect(migratedDb.prepare<{ user_version: number }>("PRAGMA user_version").get()).toEqual({
      user_version: 10,
    });
    expect(
      migratedDb
        .prepare<{ time_zone: string | null }>("SELECT time_zone FROM projects WHERE id='p-v6'")
        .get(),
    ).toEqual({ time_zone: null });

    // 3. Verify backfilled records
    const vRows = migratedDb
      .prepare<{ id: string; response_id: string }>("SELECT id, response_id FROM response_versions")
      .all();
    expect(vRows).toHaveLength(1);
    expect(vRows[0]?.response_id).toBe("resp-v6");

    const rrvRows = migratedDb
      .prepare<{ revision_id: string; response_version_id: string }>(
        "SELECT revision_id, response_version_id FROM revision_response_versions",
      )
      .all();
    expect(rrvRows).toHaveLength(1);
    expect(rrvRows[0]?.revision_id).toBe("rev-1");

    // 4. Verify ProjectRepository loads historical source via version tables
    const repo = new ProjectRepository(migratedDb);
    const source = repo.loadSynthesisSource("p-v6" as never, "rev-1" as never);
    expect(source).not.toBeNull();
    expect(source!.responses).toHaveLength(1);
    expect(source!.responses[0]!.responseId).toBe("resp-v6");
    expect(source!.responses[0]!.answers["q1"]).toMatchObject({
      state: "answered",
      value: { label: "Yes" },
    });

    migratedDb.close();
    await rm(directory, { recursive: true, force: true });
  });
});
