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
    first.prepare("INSERT INTO projects VALUES ('p','a','f','marker','r','now','now')").run();
    first.close();
    const raw = await readFile(path);
    expect(raw.includes(Buffer.from("marker"))).toBe(false);
    const reopened = await ProjectDatabase.open(path, secrets);
    expect(
      reopened.prepare<{ name: string }>("SELECT name FROM projects WHERE id='p'").get(),
    ).toEqual({ name: "marker" });
    expect(reopened.prepare<{ user_version: number }>("PRAGMA user_version").get()).toEqual({
      user_version: 6,
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
      user_version: 6,
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
});
