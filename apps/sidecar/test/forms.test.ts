import { describe, expect, it, vi } from "vitest";

import type { FormId, GoogleAccount, GoogleAccountId } from "@survey-synth/domain";
import { resolveResponsePath } from "@survey-synth/domain";

import { sidecarError } from "../src/errors.js";
import type { GoogleAccessTokenProvider } from "../src/auth/tokens.js";
import { MemoryGoogleAccountRepository } from "../src/auth/account-store.js";
import {
  GoogleFormsApiClient,
  type GoogleFormsApi,
  type FormsListRequest,
} from "../src/forms/client.js";
import { fetchAllResponses } from "../src/forms/pagination.js";
import { GoogleFormNormalizer, GoogleResponseNormalizer } from "../src/forms/normalizer.js";
import { FormImportService, MemoryFormImportStore } from "../src/forms/service.js";
import type {
  RawDriveFileList,
  RawGoogleForm,
  RawGoogleFormResponse,
  RawGoogleFormResponsePage,
  RawGoogleQuestion,
} from "../src/forms/google-types.js";
import type { SafeLogger } from "../src/rpc/logger.js";

const account = (id: string, subject: string): GoogleAccount => ({
  id: id as GoogleAccountId,
  subject,
  email: `${subject}@example.com`,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-01T00:00:00.000Z",
});

const logger: SafeLogger = { info: vi.fn(), error: vi.fn() };

const fixtureForm = (): RawGoogleForm => ({
  formId: "form-1",
  info: { title: "Customer survey", description: "Description" },
  items: [
    {
      itemId: "q-choice-item",
      title: "Route",
      questionItem: {
        question: {
          questionId: "q-route",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "Next", goToAction: "NEXT_SECTION" },
              { value: "Submit", goToAction: "SUBMIT_FORM" },
            ],
          },
        },
      },
    },
    {
      itemId: "section-2",
      title: "Details",
      pageBreakItem: {},
    },
    {
      itemId: "q-text-item",
      title: "Comment",
      questionItem: {
        question: {
          questionId: "q-text",
          textQuestion: { paragraph: true },
        },
      },
    },
    {
      itemId: "q-choice-dropdown-item",
      title: "Dropdown",
      questionItem: {
        question: {
          questionId: "q-dropdown",
          choiceQuestion: {
            type: "DROP_DOWN",
            options: [{ value: "One" }, { value: "Two" }],
          },
        },
      },
    },
    {
      itemId: "q-checkbox-item",
      title: "Tags",
      questionItem: {
        question: {
          questionId: "q-checkbox",
          choiceQuestion: {
            type: "CHECKBOX",
            options: [{ value: "A" }, { value: "B" }],
          },
        },
      },
    },
    {
      itemId: "q-scale-item",
      title: "Satisfaction",
      questionItem: {
        question: {
          questionId: "q-scale",
          scaleQuestion: { low: 1, high: 5, lowLabel: "Low", highLabel: "High" },
        },
      },
    },
    {
      itemId: "q-rating-item",
      title: "Rating",
      questionItem: {
        question: {
          questionId: "q-rating",
          ratingQuestion: { ratingScaleLevel: 5, iconType: "STAR" },
        },
      },
    },
    {
      itemId: "q-date-item",
      title: "Date",
      questionItem: {
        question: {
          questionId: "q-date",
          dateQuestion: { includeYear: true, includeTime: true },
        },
      },
    },
    {
      itemId: "q-time-item",
      title: "Duration",
      questionItem: {
        question: {
          questionId: "q-time",
          timeQuestion: { duration: true },
        },
      },
    },
    {
      itemId: "q-file-item",
      title: "Attachment",
      questionItem: {
        question: {
          questionId: "q-file",
          fileUploadQuestion: { types: ["PDF"], maxFiles: 2, maxFileSize: "1048576" },
        },
      },
    },
    {
      itemId: "section-3",
      title: "Grid",
      pageBreakItem: {},
    },
    {
      itemId: "q-grid-item",
      title: "Grid question",
      questionGroupItem: {
        grid: {
          columns: { type: "RADIO", options: [{ value: "Never" }, { value: "Often" }] },
          shuffleQuestions: true,
        },
        questions: [
          { questionId: "q-grid-1", rowQuestion: { title: "Service" } },
          { questionId: "q-grid-2", rowQuestion: { title: "Support" } },
        ],
      },
    },
    {
      itemId: "q-unknown-item",
      title: "Future",
      questionItem: {
        question: {
          questionId: "q-unknown",
          futureQuestion: {},
        } as unknown as RawGoogleQuestion,
      },
    },
  ],
});

const branchingForm = (): RawGoogleForm => ({
  formId: "branching-form",
  info: { title: "Branching survey" },
  items: [
    {
      itemId: "q-branch-item",
      title: "Path",
      questionItem: {
        question: {
          questionId: "q-branch",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "A", goToSectionId: "section-a" },
              { value: "B", goToSectionId: "section-b" },
              { value: "Restart", goToAction: "RESTART_FORM" },
            ],
          },
        },
      },
    },
    {
      itemId: "section-a",
      title: "A",
      pageBreakItem: {},
    },
    {
      itemId: "q-a-item",
      title: "A required",
      questionItem: {
        question: {
          questionId: "q-a",
          required: true,
          textQuestion: {},
        },
      },
    },
    {
      itemId: "section-b",
      title: "B",
      pageBreakItem: {},
    },
    {
      itemId: "q-b-item",
      title: "B required",
      questionItem: {
        question: {
          questionId: "q-b",
          required: true,
          textQuestion: {},
        },
      },
    },
  ],
});

const response = (
  responseId: string,
  answers: Record<string, { questionId?: string; textAnswers?: { answers: { value: string }[] } }>,
): RawGoogleFormResponse => ({
  responseId,
  createTime: "2026-09-01T00:00:00Z",
  lastSubmittedTime: "2026-09-01T00:01:00Z",
  answers,
});

describe("Google Form normalization", () => {
  it("uses the standard label for a Google Other option without a value", () => {
    const form = new GoogleFormNormalizer().normalize({
      formId: "other-form",
      info: { title: "Other option" },
      items: [
        {
          itemId: "other-item",
          title: "Choice",
          questionItem: {
            question: {
              questionId: "other-question",
              choiceQuestion: {
                type: "RADIO",
                options: [{ value: "Known" }, { isOther: true }],
              },
            },
          },
        },
      ],
    });

    expect(form.questions[0]).toMatchObject({
      kind: "single_choice",
      options: [{ label: "Known" }, { label: "Other", isOther: true }],
    });
  });

  it("normalizes supported questions, grouped grid rows, unsupported types, and routing", () => {
    const snapshot = new GoogleFormNormalizer().normalize(fixtureForm(), "2026-09-02T00:00:00Z");

    expect(snapshot.formId).toBe("form-1");
    expect(snapshot.sections.map((section) => section.id)).toEqual([
      "__entry__",
      "section-2",
      "section-3",
    ]);
    expect(snapshot.questions.map((question) => question.kind)).toEqual([
      "single_choice",
      "text",
      "single_choice",
      "multi_choice",
      "ordinal",
      "ordinal",
      "date",
      "time",
      "file",
      "single_choice",
      "single_choice",
      "unsupported",
    ]);
    expect(snapshot.questions.find((question) => question.id === "q-text")).toMatchObject({
      kind: "text",
      presentation: "paragraph",
    });
    expect(snapshot.questions.find((question) => question.id === "q-rating")).toMatchObject({
      kind: "ordinal",
      presentation: "rating_star",
      min: 1,
      max: 5,
    });
    expect(snapshot.questions.find((question) => question.id === "q-file")).toMatchObject({
      kind: "file",
      allowedTypes: ["PDF"],
      maxFiles: 2,
      maxFileSizeBytes: "1048576",
    });
    expect(snapshot.questions.find((question) => question.id === "q-unknown")).toMatchObject({
      kind: "unsupported",
      sourceType: "futureQuestion",
    });

    const group = snapshot.groups[0];
    expect(group).toMatchObject({
      id: "q-grid-item",
      kind: "grid",
      presentation: "radio",
      shuffleQuestions: true,
    });
    expect(group?.questionIds).toEqual(["q-grid-1", "q-grid-2"]);
    const gridRows = snapshot.questions.filter((question) => question.groupId === "q-grid-item");
    expect(gridRows).toHaveLength(2);
    const firstGridRow = gridRows[0];
    expect(firstGridRow).toMatchObject({ kind: "single_choice", options: group?.options });
    if (firstGridRow?.kind !== "single_choice") throw new Error("Expected radio grid row");
    expect(firstGridRow.options[0]?.key).toBe(group?.options[0]?.key);
    expect(group?.options[0]?.key).not.toBe(group?.options[1]?.key);

    expect(snapshot.logic).toMatchObject({
      entrySectionId: "__entry__",
      coverage: "partial",
      hasRestartFlow: false,
    });
    expect(snapshot.logic.sections[0]?.nextSectionId).toBe("section-2");
    const routeQuestion = snapshot.questions.find((question) => question.id === "q-route");
    if (routeQuestion?.kind !== "single_choice") throw new Error("Expected route question");
    expect(snapshot.logic.transitions).toEqual([
      {
        sourceQuestionId: "q-route",
        optionKey: routeQuestion.options[0]?.key,
        destination: { type: "next_section" },
        evidence: "api_confirmed",
      },
      {
        sourceQuestionId: "q-route",
        optionKey: routeQuestion.options[1]?.key,
        destination: { type: "submit" },
        evidence: "api_confirmed",
      },
    ]);
    expect(snapshot.questions[0]).toMatchObject({ affectsNavigation: true });
  });

  it("keeps schema hash independent of capture time and provider revision noise", () => {
    const first = new GoogleFormNormalizer().normalize(
      { ...fixtureForm(), revisionId: "revision-a" },
      "2026-09-02T00:00:00Z",
    );
    const second = new GoogleFormNormalizer().normalize(
      { ...fixtureForm(), revisionId: "revision-b" },
      "2026-09-03T00:00:00Z",
    );

    expect(first.schemaHash).toBe(second.schemaHash);
    expect(first.schemaHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Google response normalization and conservative paths", () => {
  it("preserves values and distinguishes skipped, not-reached, and indeterminate", () => {
    const form = new GoogleFormNormalizer().normalize(fixtureForm(), "2026-09-02T00:00:00Z");
    const normalizer = new GoogleResponseNormalizer();
    const [next, submit] = normalizer.normalizeAll(form, [
      response("r-next", {
        "q-route": { questionId: "q-route", textAnswers: { answers: [{ value: "Next" }] } },
        "q-text": {
          questionId: "q-text",
          textAnswers: { answers: [{ value: "Keep exact text" }] },
        },
        "q-scale": { questionId: "q-scale", textAnswers: { answers: [{ value: "4" }] } },
      }),
      response("r-submit", {
        "q-route": { questionId: "q-route", textAnswers: { answers: [{ value: "Submit" }] } },
      }),
    ]);

    expect(next?.answers["q-text"]).toEqual({
      state: "answered",
      value: { kind: "text", value: "Keep exact text" },
    });
    expect(next?.answers["q-dropdown"]).toEqual({ state: "skipped" });
    expect(next?.answers["q-grid-1"]).toEqual({ state: "indeterminate" });
    expect(next?.answers["q-route"]).toMatchObject({
      state: "answered",
      value: { kind: "single_choice", label: "Next" },
    });
    expect(next?.answers["q-scale"]).toEqual({
      state: "answered",
      value: { kind: "ordinal", value: 4 },
    });
    expect(next?.path.questions["q-text"]).toBe("reached");
    expect(next?.path.questions["q-grid-1"]).toBe("indeterminate");
    expect(next?.path.confidence).toBe("partial");

    expect(submit?.answers["q-text"]).toEqual({ state: "not_reached" });
    expect(submit?.answers["q-grid-1"]).toEqual({ state: "not_reached" });
    expect(submit?.path.questions["q-text"]).toBe("not_reached");
  });

  it("does not use section order as proof of reachability", () => {
    const form = new GoogleFormNormalizer().normalize(fixtureForm(), "2026-09-02T00:00:00Z");
    const routeQuestion = form.questions.find((question) => question.id === "q-route");
    if (routeQuestion?.kind !== "single_choice") throw new Error("Expected route question");
    const nextOption = routeQuestion.options[0];
    if (nextOption === undefined) throw new Error("Expected route option");
    const path = resolveResponsePath(form, {
      "q-route": {
        state: "answered",
        value: {
          kind: "single_choice",
          optionKey: nextOption.key,
          label: "Next",
        },
      },
    });
    expect(path.questions["q-grid-1"]).toBe("indeterminate");
  });

  it("marks bypassed sections and preserves restart ambiguity", () => {
    const form = new GoogleFormNormalizer().normalize(branchingForm(), "2026-09-02T00:00:00Z");
    const routeQuestion = form.questions.find((question) => question.id === "q-branch");
    if (routeQuestion?.kind !== "single_choice") throw new Error("Expected branch question");
    expect(form.logic.transitions.map((transition) => transition.destination)).toEqual([
      { type: "section", sectionId: "section-a" },
      { type: "section", sectionId: "section-b" },
      { type: "restart" },
    ]);

    const [branchA, branchB, restart] = new GoogleResponseNormalizer().normalizeAll(form, [
      response("branch-a", {
        "q-branch": { textAnswers: { answers: [{ value: "A" }] } },
      }),
      response("branch-b", {
        "q-branch": { textAnswers: { answers: [{ value: "B" }] } },
      }),
      response("restart", {
        "q-branch": { textAnswers: { answers: [{ value: "Restart" }] } },
      }),
    ]);

    expect(branchA?.answers["q-a"]).toEqual({ state: "indeterminate" });
    expect(branchA?.answers["q-b"]).toEqual({ state: "indeterminate" });
    expect(branchB?.answers["q-a"]).toEqual({ state: "not_reached" });
    expect(branchB?.answers["q-b"]).toEqual({ state: "indeterminate" });
    expect(restart?.answers["q-a"]).toEqual({ state: "indeterminate" });
    expect(restart?.answers["q-b"]).toEqual({ state: "indeterminate" });
    expect(restart?.path.confidence).toBe("ambiguous");
    expect(routeQuestion.options[2]?.key).toBe(
      restart?.answers["q-branch"]?.value.kind === "single_choice"
        ? restart.answers["q-branch"].value.optionKey
        : undefined,
    );
  });
});

describe("response pagination", () => {
  it("fetches every page exactly once, including an empty final page", async () => {
    const calls: (string | undefined)[] = [];
    const pages: Record<string, RawGoogleFormResponsePage> = {
      first: { responses: [response("r1", {})], nextPageToken: "second" },
      second: { responses: [response("r2", {})], nextPageToken: "third" },
      third: { responses: [], nextPageToken: "final" },
      final: { responses: [] },
    };
    const result = await fetchAllResponses(async (pageToken) => {
      calls.push(pageToken);
      return pageToken === undefined ? pages.first : (pages[pageToken] ?? { responses: [] });
    });

    expect(result.map((item) => item.responseId)).toEqual(["r1", "r2"]);
    expect(calls).toEqual([undefined, "second", "third", "final"]);
  });

  it("fails instead of succeeding with partial or duplicated pagination", async () => {
    const failure = await fetchAllResponses(async (pageToken) => {
      if (pageToken === undefined)
        return { responses: [response("r1", {})], nextPageToken: "next" };
      throw sidecarError("GOOGLE_API_ERROR", "page failed", true);
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ backendError: { code: "GOOGLE_API_ERROR" } });

    await expect(
      fetchAllResponses(async () => ({ responses: [response("r1", {})], nextPageToken: "same" })),
    ).rejects.toMatchObject({ backendError: { code: "GOOGLE_API_ERROR" } });
    await expect(
      fetchAllResponses(async (pageToken) =>
        pageToken === undefined
          ? { responses: [response("r1", {})], nextPageToken: "next" }
          : { responses: [response("r1", {})] },
      ),
    ).rejects.toMatchObject({ backendError: { code: "GOOGLE_API_ERROR" } });
  });

  it("stops before fetching after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAllResponses(vi.fn(), controller.signal)).rejects.toMatchObject({
      backendError: { code: "JOB_CANCELLED" },
    });
  });
});

class FakeFormsApi implements GoogleFormsApi {
  public readonly listAccountIds: GoogleAccountId[] = [];
  public readonly importAccountIds: GoogleAccountId[] = [];
  public form: RawGoogleForm = fixtureForm();
  public pages: RawGoogleFormResponsePage[] = [{ responses: [response("r1", {})] }];
  public listResult: RawDriveFileList = {
    files: [{ id: "form-1", name: "Customer survey", modifiedTime: "2026-08-28T00:00:00Z" }],
  };

  public listForms(
    accountId: GoogleAccountId,
    _request: FormsListRequest,
  ): Promise<RawDriveFileList> {
    this.listAccountIds.push(accountId);
    return Promise.resolve(this.listResult);
  }

  public getForm(
    accountId: GoogleAccountId,
    _formId: FormId,
    _signal?: AbortSignal,
  ): Promise<RawGoogleForm> {
    this.importAccountIds.push(accountId);
    return Promise.resolve(this.form);
  }

  public listResponses(
    _accountId: GoogleAccountId,
    _formId: FormId,
    pageToken?: string,
  ): Promise<RawGoogleFormResponsePage> {
    const index = pageToken === undefined ? 0 : Number(pageToken);
    const page = this.pages[index];
    if (page === undefined)
      return Promise.reject(sidecarError("GOOGLE_API_ERROR", "page failed", true));
    return Promise.resolve({
      ...page,
      ...(index + 1 < this.pages.length ? { nextPageToken: String(index + 1) } : {}),
    });
  }
}

describe("Form import service and Google API client", () => {
  it("scopes list/import to account captured at operation start and stores only normalized data", async () => {
    const first = account("account-a", "a");
    const second = account("account-b", "b");
    const accounts = new MemoryGoogleAccountRepository([first, second], first.id);
    const google = new FakeFormsApi();
    const store = new MemoryFormImportStore();
    const service = new FormImportService({ accounts, google, logger, store });

    await expect(service.listForms({ query: "Customer" })).resolves.toEqual({
      items: [
        {
          formId: "form-1",
          title: "Customer survey",
          modifiedAt: "2026-08-28T00:00:00Z",
        },
      ],
    });
    const summary = await service.importForm("form-1" as FormId);
    expect(summary).toMatchObject({ formId: "form-1", responseCount: 1 });
    expect(service.getImport(summary.importId)).toMatchObject({
      accountId: first.id,
      form: { formId: "form-1" },
      responses: [{ origin: "original" }],
    });

    await accounts.setLastAccountId(second.id);
    await service.listForms({});
    expect(google.listAccountIds).toEqual([first.id, second.id]);
    expect(google.importAccountIds).toEqual([first.id]);
  });

  it("rejects zero-response forms and failed imports without storing a session", async () => {
    const first = account("account-a", "a");
    const accounts = new MemoryGoogleAccountRepository([first], first.id);
    const google = new FakeFormsApi();
    google.pages = [{ responses: [] }];
    const store = new MemoryFormImportStore();
    const service = new FormImportService({ accounts, google, logger, store });

    await expect(service.importForm("form-1" as FormId)).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    expect(store.get("missing")).toBeNull();

    google.pages = [{ responses: [response("r1", {})], nextPageToken: "1" }];
    await expect(service.importForm("form-1" as FormId)).rejects.toMatchObject({
      backendError: { code: "GOOGLE_API_ERROR" },
    });
  });

  it("uses Drive shared-file flags, narrow fields, and central 401 refresh handling", async () => {
    const accessTokens: GoogleAccessTokenProvider = {
      getAccessToken: vi.fn(async () => "stale-token"),
      forceRefresh: vi.fn(async () => "fresh-token"),
    };
    const seenRequests: NonNullable<Parameters<typeof fetch>[1]>[] = [];
    const fetchImpl = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        seenRequests.push(init ?? {});
        const url = new URL(String(input));
        if (url.pathname.endsWith("/files")) {
          if (seenRequests.length === 1) return new Response("{}", { status: 401 });
          return new Response(JSON.stringify({ files: [{ id: "form-1", name: "Survey" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      },
    );
    const client = new GoogleFormsApiClient({ accessTokens, fetchImpl });
    const page = await client.listForms("account-a" as GoogleAccountId, { query: "O'Reilly" });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(page.files).toEqual([{ id: "form-1", name: "Survey" }]);
    expect(url.searchParams.get("q")).toContain("mimeType = 'application/vnd.google-apps.form'");
    expect(url.searchParams.get("q")).toContain("name contains 'O\\'Reilly'");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toBe(
      "incompleteSearch,nextPageToken,files(id,name,modifiedTime)",
    );
    expect(accessTokens.forceRefresh).toHaveBeenCalledOnce();
    expect(seenRequests[0]?.headers).toMatchObject({ authorization: "Bearer stale-token" });
    expect(seenRequests[1]?.headers).toMatchObject({ authorization: "Bearer fresh-token" });
  });
});
