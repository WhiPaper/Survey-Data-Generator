import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  FormId,
  GoogleAccount,
  GoogleAccountId,
  OptionKey,
  QuestionId,
  SourceRevisionId,
} from "@survey-synth/domain";
import { synthesize } from "@survey-synth/synthesis-core";

import type { SecureSecretStore } from "../src/host.js";
import { ProjectDatabase } from "../src/persistence/database.js";
import { ProjectRepository } from "../src/persistence/projects.js";
import { MemoryGoogleAccountRepository } from "../src/auth/account-store.js";
import { FormImportService } from "../src/forms/service.js";
import type { GoogleFormsApi, FormsListRequest } from "../src/forms/client.js";
import type {
  RawDriveFileList,
  RawGoogleForm,
  RawGoogleFormResponse,
  RawGoogleFormResponsePage,
} from "../src/forms/google-types.js";
import { RefreshService } from "../src/application/refresh-service.js";
import type { SafeLogger } from "../src/rpc/logger.js";

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

const mockLogger: SafeLogger = { info: vi.fn(), error: vi.fn() };

const createMockGoogleApi = (
  initialForm: RawGoogleForm,
  initialResponses: RawGoogleFormResponse[],
): GoogleFormsApi & {
  form: RawGoogleForm;
  responses: RawGoogleFormResponse[];
} => {
  const state = {
    form: initialForm,
    responses: initialResponses,
  };
  return {
    get form() {
      return state.form;
    },
    set form(val) {
      state.form = val;
    },
    get responses() {
      return state.responses;
    },
    set responses(val) {
      state.responses = val;
    },
    async listForms(
      _accountId: GoogleAccountId,
      _request: FormsListRequest,
      _signal?: AbortSignal,
    ): Promise<RawDriveFileList> {
      return { files: [] };
    },
    async getForm(
      _accountId: GoogleAccountId,
      _formId: FormId,
      _signal?: AbortSignal,
    ): Promise<RawGoogleForm> {
      return state.form;
    },
    async listResponses(
      _accountId: GoogleAccountId,
      _formId: FormId,
      _pageToken?: string,
      _signal?: AbortSignal,
    ): Promise<RawGoogleFormResponsePage> {
      return { responses: state.responses };
    },
  };
};

const sampleRawForm = (): RawGoogleForm => ({
  formId: "form-1",
  info: { title: "Satisfaction Survey", description: "Customer satisfaction" },
  items: [
    {
      itemId: "item-q1",
      title: "How satisfied are you?",
      questionItem: {
        question: {
          questionId: "q-sat",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [{ value: "Satisfied" }, { value: "Neutral" }, { value: "Dissatisfied" }],
          },
        },
      },
    },
    {
      itemId: "item-q2",
      title: "Score (1-5)",
      questionItem: {
        question: {
          questionId: "q-score",
          required: false,
          scaleQuestion: {
            low: 1,
            high: 5,
          },
        },
      },
    },
  ],
});

const sampleResponses = (): RawGoogleFormResponse[] => [
  {
    responseId: "resp-1",
    createTime: "2026-01-01T10:00:00.000Z",
    lastSubmittedTime: "2026-01-01T10:00:00.000Z",
    answers: {
      "q-sat": {
        questionId: "q-sat",
        textAnswers: { answers: [{ value: "Satisfied" }] },
      },
      "q-score": {
        questionId: "q-score",
        textAnswers: { answers: [{ value: "5" }] },
      },
    },
  },
  {
    responseId: "resp-2",
    createTime: "2026-01-01T11:00:00.000Z",
    lastSubmittedTime: "2026-01-01T11:00:00.000Z",
    answers: {
      "q-sat": {
        questionId: "q-sat",
        textAnswers: { answers: [{ value: "Neutral" }] },
      },
      "q-score": {
        questionId: "q-score",
        textAnswers: { answers: [{ value: "3" }] },
      },
    },
  },
];

describe("M7 Source Refresh and SourceRevision Lifecycle Integration", () => {
  it("detects no-change when remote form and responses are identical", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-refresh-noop-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    // 1. Initial import
    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);
    const initialRevId = project.currentSourceRevisionId;

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    // 2. Perform refresh with no changes
    const result = await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 0,
    });

    expect(result.status).toBe("no_change");
    expect(result.sourceRevisionId).toBe(initialRevId);
    expect(result.sourceResponseCount).toBe(2);

    // Verify database did not create a new revision
    const currentProject = repo.get(project.id)!;
    expect(currentProject.currentSourceRevisionId).toBe(initialRevId);

    const revisions = db
      .prepare<{ count: number }>(
        "SELECT count(*) as count FROM source_revisions WHERE project_id = ?",
      )
      .get(project.id);
    expect(revisions?.count).toBe(1);

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("appends a new SourceRevision and versioned responses when remote responses change", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-refresh-updated-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    // 1. Initial import
    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);
    const initialRevId = project.currentSourceRevisionId;

    // 2. Update remote responses: 1 added, 1 modified
    const updatedResponses: RawGoogleFormResponse[] = [
      sampleResponses()[0], // unchanged
      {
        responseId: "resp-2",
        createTime: "2026-01-01T11:00:00.000Z",
        lastSubmittedTime: "2026-01-01T11:30:00.000Z", // changed submission time and answer
        answers: {
          "q-sat": {
            questionId: "q-sat",
            textAnswers: { answers: [{ value: "Dissatisfied" }] },
          },
        },
      },
      {
        responseId: "resp-3", // new response
        createTime: "2026-01-01T12:00:00.000Z",
        lastSubmittedTime: "2026-01-01T12:00:00.000Z",
        answers: {
          "q-sat": {
            questionId: "q-sat",
            textAnswers: { answers: [{ value: "Satisfied" }] },
          },
          "q-score": {
            questionId: "q-score",
            textAnswers: { answers: [{ value: "4" }] },
          },
        },
      },
    ];
    mockApi.responses = updatedResponses;

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    const result = await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 0,
    });

    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.addedResponseCount).toBe(1);
      expect(result.changedResponseCount).toBe(1);
      expect(result.removedResponseCount).toBe(0);
      expect(result.sourceResponseCount).toBe(3);
      expect(result.sourceRevisionId).not.toBe(initialRevId);
      expect(result.targetRevision).toBe(1);

      // Verify current revision advanced
      const currentProject = repo.get(project.id)!;
      expect(currentProject.currentSourceRevisionId).toBe(result.sourceRevisionId);
      expect(currentProject.responseCount).toBe(3);

      // Verify revision 1 historical data is still completely intact
      const rev1Source = repo.loadSynthesisSource(project.id, initialRevId as SourceRevisionId);
      expect(rev1Source).not.toBeNull();
      expect(
        rev1Source!.responses.find((r) => r.responseId === "resp-2")?.answers["q-sat"],
      ).toMatchObject({
        state: "answered",
        value: { label: "Neutral" },
      });

      // Verify revision 2 data has updated responses
      const rev2Source = repo.loadSynthesisSource(
        project.id,
        result.sourceRevisionId as SourceRevisionId,
      );
      expect(rev2Source).not.toBeNull();
      expect(rev2Source!.responses).toHaveLength(3);
      expect(
        rev2Source!.responses.find((r) => r.responseId === "resp-2")?.answers["q-sat"],
      ).toMatchObject({
        state: "answered",
        value: { label: "Dissatisfied" },
      });
    }

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates targets on question deletion and records migration issues", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-refresh-target-migration-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);

    // Set initial targets for both questions
    repo.updateTargets(project.id, 0, {
      targetResponseCount: 10,
      questionTargets: [
        {
          questionId: "q-sat",
          kind: "single_choice",
          optionTargets: { Satisfied: { kind: "ratio", value: 0.7 } },
        },
        {
          questionId: "q-score",
          kind: "mean",
          meanTarget: { kind: "exact", value: 4.5 },
        },
      ],
    });

    // Remote form modifies structure: deletes q-score
    const newRawForm: RawGoogleForm = {
      formId: "form-1",
      info: { title: "Satisfaction Survey Updated" },
      items: [
        {
          itemId: "item-q1",
          title: "How satisfied are you?",
          questionItem: {
            question: {
              questionId: "q-sat",
              required: true,
              choiceQuestion: {
                type: "RADIO",
                options: [{ value: "Satisfied" }, { value: "Neutral" }], // Dissatisfied removed
              },
            },
          },
        },
      ],
    };
    mockApi.form = newRawForm;

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    const result = await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 1,
    });
    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
      const deletedIssue = result.issues.find((i) => i.code === "question_deleted");
      expect(deletedIssue).toBeDefined();
      expect(deletedIssue?.severity).toBe("blocking");

      // Verify migrated targets dropped q-score and preserved targetResponseCount
      const currentTargets = repo.getTargets(project.id);
      expect(currentTargets.targets.targetResponseCount).toBe(10);
      expect(
        currentTargets.targets.questionTargets.find((t) => t.questionId === "q-score"),
      ).toBeUndefined();

      // Issues are stored and queryable
      const storedIssues = repo.getMigrationIssues(project.id);
      expect(storedIssues.length).toBeGreaterThanOrEqual(1);

      // Resolving the issue removes it and increments revision
      repo.resolveMigrationIssue(project.id, deletedIssue!.id, "remove_target");
      const remainingIssues = repo.getMigrationIssues(project.id);
      expect(remainingIssues.find((i) => i.id === deletedIssue!.id)).toBeUndefined();
      expect(repo.getTargets(project.id).revision).toBe(3);
    }

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves historical SynthesisRun inputs completely across source refreshes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-refresh-run-preservation-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);
    const rev1Id = project.currentSourceRevisionId;

    // Execute synthesis on rev1
    const source1 = repo.loadSynthesisSource(project.id)!;
    const targetState1 = repo.getTargets(project.id);
    const runResult = synthesize(
      source1.form,
      source1.responses,
      { targetResponseCount: 3, questionTargets: [] },
      12345,
    );
    expect(runResult.kind).toBe("success");
    if (runResult.kind === "success") {
      const runRecord = repo.saveRun({
        projectId: project.id,
        sourceRevisionId: rev1Id as SourceRevisionId,
        targets: { targetResponseCount: 3, questionTargets: [] },
        seed: 12345,
        synthetic: runResult.synthetic,
        validation: runResult.validation,
        targetRevision: targetState1.revision,
      });

      // Now refresh source to create rev2
      mockApi.responses = [
        ...sampleResponses(),
        {
          responseId: "resp-new",
          createTime: "2026-01-02T00:00:00.000Z",
          lastSubmittedTime: "2026-01-02T00:00:00.000Z",
          answers: {},
        },
      ];

      const refreshService = new RefreshService({
        projectRepository: repo,
        formImportService: formsService,
      });
      const refreshResult = await refreshService.refreshSource({
        projectId: project.id,
        expectedTargetRevision: targetState1.revision,
      });
      expect(refreshResult.status).toBe("updated");

      // Verify the Run is frozen to rev1
      const savedRun = repo.getRun(runRecord.id);
      expect(savedRun).not.toBeNull();
      expect(savedRun!.sourceRevisionId).toBe(rev1Id);
      expect(savedRun!.targetRevision).toBe(targetState1.revision);
      expect(savedRun!.appVersion).toBe("0.1.0");

      // Verify we can still load exact source inputs for that run
      const runSource = repo.loadSynthesisSource(
        project.id,
        savedRun!.sourceRevisionId as SourceRevisionId,
      );
      expect(runSource).not.toBeNull();
      expect(runSource!.responses).toHaveLength(2); // Initial 2 responses
    }

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("handles cancellation without modifying project revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-refresh-cancellation-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);
    const initialRevId = project.currentSourceRevisionId;

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    const opId = "cancel-test-op";
    // Pre-cancel
    refreshService.cancel(opId);

    await expect(
      refreshService.refreshSource({
        projectId: project.id,
        expectedTargetRevision: 0,
        operationId: opId,
      }),
    ).rejects.toMatchObject({
      backendError: { code: "JOB_CANCELLED" },
    });

    // Project revision remains unchanged
    const currentProject = repo.get(project.id)!;
    expect(currentProject.currentSourceRevisionId).toBe(initialRevId);

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects plain acknowledgment for blocking issues and requires remove_target with atomic revision bump", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-atomic-resolution-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);

    // Add target on q-sat
    repo.updateTargets(project.id, 0, {
      targetResponseCount: 10,
      questionTargets: [
        {
          kind: "option",
          questionId: "q-sat" as QuestionId,
          optionKey: "Satisfied" as OptionKey,
          target: { kind: "ratio", value: 0.7 },
        },
      ],
    });

    // Remote deletes q-sat
    mockApi.form = {
      formId: "form-1",
      info: { title: "Deleted q-sat" },
      items: [],
    };

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    const refreshResult = await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 1,
    });
    expect(refreshResult.status).toBe("updated");
    if (refreshResult.status !== "updated") throw new Error("Expected updated");

    const blockingIssue = refreshResult.issues.find((i) => i.severity === "blocking");
    expect(blockingIssue).toBeDefined();

    // 1. Acknowledgment alone must fail
    expect(() => {
      repo.resolveMigrationIssue(project.id, blockingIssue!.id, "acknowledge");
    }).toThrow(/cannot be resolved by acknowledgment alone/);

    // 2. remove_target succeeds atomically and bumps target revision
    const preTargets = repo.getTargets(project.id);
    repo.resolveMigrationIssue(project.id, blockingIssue!.id, "remove_target");
    const postTargets = repo.getTargets(project.id);

    expect(postTargets.revision).toBe(preTargets.revision + 1);
    expect(postTargets.targets.questionTargets).toHaveLength(0);
    expect(repo.getMigrationIssues(project.id)).toHaveLength(0);

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects refresh when unresolved blocking migration issues exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-blocking-prevention-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);

    // Target q-sat
    repo.updateTargets(project.id, 0, {
      targetResponseCount: 10,
      questionTargets: [
        {
          kind: "option",
          questionId: "q-sat" as QuestionId,
          optionKey: "Satisfied" as OptionKey,
          target: { kind: "ratio", value: 0.7 },
        },
      ],
    });

    // First refresh introduces blocking issue
    mockApi.form = { formId: "form-1", info: { title: "Deleted" }, items: [] };
    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 1,
    });

    // Second refresh attempted without resolving blocking issue -> MUST FAIL
    await expect(
      refreshService.refreshSource({
        projectId: project.id,
        expectedTargetRevision: 2,
      }),
    ).rejects.toMatchObject({
      backendError: {
        code: "VALIDATION_FAILED",
        message: expect.stringContaining("이전 새로고침의 미해결 목표 변경사항"),
      },
    });

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("detects target revision conflict when expectedTargetRevision mismatches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-target-conflict-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const mockApi = createMockGoogleApi(sampleRawForm(), sampleResponses());
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);

    mockApi.responses = [
      ...sampleResponses(),
      {
        responseId: "resp-new",
        createTime: "2026-01-03T00:00:00.000Z",
        lastSubmittedTime: "2026-01-03T00:00:00.000Z",
        answers: {},
      },
    ];

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    // Stale revision: 99 vs actual 0
    await expect(
      refreshService.refreshSource({
        projectId: project.id,
        expectedTargetRevision: 99,
      }),
    ).rejects.toMatchObject({
      backendError: { code: "TARGET_CONFLICT" },
    });

    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves no_change status when responses arrive in different array order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m7-order-invariance-"));
    const dbPath = join(directory, "projects.db");
    const secrets = new TestSecrets();
    const db = await ProjectDatabase.open(dbPath, secrets);
    const repo = new ProjectRepository(db);

    const account: GoogleAccount = {
      id: "acc-1" as GoogleAccountId,
      subject: "sub-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    const accounts = new MemoryGoogleAccountRepository([account], account.id);
    const initialResponses = sampleResponses(); // resp-1, resp-2
    const mockApi = createMockGoogleApi(sampleRawForm(), initialResponses);
    const formsService = new FormImportService({
      accounts,
      google: mockApi,
      logger: mockLogger,
    });

    const { form, responses } = await formsService.fetchAndNormalize(
      account.id,
      "form-1" as FormId,
    );
    const { project } = repo.createFromImport(account.id, form, responses);

    // Reverse order of identical responses
    mockApi.responses = [initialResponses[1]!, initialResponses[0]!];

    const refreshService = new RefreshService({
      projectRepository: repo,
      formImportService: formsService,
    });

    const result = await refreshService.refreshSource({
      projectId: project.id,
      expectedTargetRevision: 0,
    });

    expect(result.status).toBe("no_change");

    db.close();
    await rm(directory, { recursive: true, force: true });
  });
});
