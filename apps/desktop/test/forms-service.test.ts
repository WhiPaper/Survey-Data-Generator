import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormId, GoogleAccountId } from "@survey-synth/domain";

import type { GoogleAuthService } from "../electron/main/auth/service";
import type { GoogleFormsClient } from "../electron/main/forms/google-client";
import { createFormsService } from "../electron/main/forms/service";
import { createJobRegistry } from "../electron/main/jobs";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import {
  getProject,
  getSourceRevision,
  listProjects,
  listSourceResponses,
  upsertGoogleAccount,
} from "../electron/main/persistence/store";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];

const createDatabase = (): AppDatabase => {
  const database = openAppDatabase({ filename: ":memory:", migrationsFolder });
  databases.push(database);
  upsertGoogleAccount(database.db, {
    id: "google-sub-1",
    email: "user@example.com",
    displayName: "Survey User",
    nowMs: 1_000,
  });
  return database;
};

const fakeAuth = (): GoogleAuthService => ({
  getSession: vi.fn(async () => ({
    account: {
      id: "google-sub-1" as GoogleAccountId,
      email: "user@example.com",
      displayName: "Survey User",
    },
  })),
  login: vi.fn(),
  addAccount: vi.fn(),
  switchAccount: vi.fn(),
  logout: vi.fn(),
  revokeAccess: vi.fn(),
  deleteAccountData: vi.fn(),
  getAccounts: vi.fn(),
  getAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
});

const rawForm = {
  formId: "form-1",
  info: { title: "Event survey" },
  items: [
    {
      itemId: "item-q1",
      title: "Satisfaction",
      questionItem: {
        question: {
          questionId: "q1",
          required: true,
          scaleQuestion: { low: 1, high: 5, lowLabel: "Low", highLabel: "High" },
        },
      },
    },
  ],
};

const rawResponses = [
  {
    responseId: "r1",
    createTime: "2026-08-01T00:00:00.000Z",
    lastSubmittedTime: "2026-08-01T00:01:00.000Z",
    answers: {
      q1: { textAnswers: { answers: [{ value: "5" }] } },
    },
  },
];

const fakeGoogle = (responses: readonly unknown[] = rawResponses): GoogleFormsClient => ({
  listForms: vi.fn(async () => ({
    items: [{ formId: "form-1" as FormId, title: "Event survey" }],
  })),
  getForm: vi.fn(async () => rawForm),
  getAllResponses: vi.fn(async () => [...responses]),
});

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("Google Forms service", () => {
  it("lists Forms for the active Google account", async () => {
    const database = createDatabase();
    const google = fakeGoogle();
    const service = createFormsService({
      auth: fakeAuth(),
      google,
      db: database.db,
      jobs: createJobRegistry(),
    });

    await expect(service.listForms({ query: "event" })).resolves.toEqual({
      items: [{ formId: "form-1", title: "Event survey" }],
    });
    expect(google.listForms).toHaveBeenCalledWith("google-sub-1", { query: "event" });
  });

  it("normalizes a Form and stores the project plus first immutable source revision", async () => {
    const database = createDatabase();
    const service = createFormsService({
      auth: fakeAuth(),
      google: fakeGoogle(),
      db: database.db,
      jobs: createJobRegistry(),
      now: () => 2_000,
    });

    const summary = await service.importForm({ formId: "form-1" as FormId });
    expect(summary).toMatchObject({
      projectId: expect.any(String),
      sourceRevisionId: expect.any(String),
      formId: "form-1",
      title: "Event survey",
      responseCount: 1,
      questionCount: 1,
    });

    const projects = listProjects(database.db);
    expect(projects).toHaveLength(1);
    expect(summary.projectId).toBe(projects[0]?.id);
    const project = getProject(database.db, summary.projectId);
    expect(project?.googleAccountId).toBe("google-sub-1");
    expect(project?.googleFormId).toBe("form-1");
    expect(project?.currentSourceRevisionId).toBe(summary.sourceRevisionId);

    const revision = getSourceRevision(database.db, summary.sourceRevisionId);
    expect(revision?.responseCount).toBe(1);
    expect(revision?.responseSetHash).toMatch(/^[a-f0-9]{64}$/);

    const responses = listSourceResponses(database.db, summary.sourceRevisionId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.responseId).toBe("r1");
    expect(responses[0]?.submittedAtMs).toBe(Date.parse("2026-08-01T00:01:00.000Z"));
    expect(responses[0]?.response).toMatchObject({
      origin: "original",
      answers: {
        q1: { state: "answered", value: { kind: "ordinal", value: 5 } },
      },
    });
  });

  it("does not create a project when the selected Form has no responses", async () => {
    const database = createDatabase();
    const service = createFormsService({
      auth: fakeAuth(),
      google: fakeGoogle([]),
      db: database.db,
      jobs: createJobRegistry(),
    });

    await expect(service.importForm({ formId: "form-1" as FormId })).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    expect(listProjects(database.db)).toEqual([]);
  });
});
