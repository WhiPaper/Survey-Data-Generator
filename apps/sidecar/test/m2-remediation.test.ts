import { describe, expect, it, vi } from "vitest";

import type { FormId, FormSnapshot, GoogleAccount, GoogleAccountId } from "@survey-synth/domain";

import {
  GOOGLE_RATE_LIMIT_MAX_RETRIES,
  callGoogleApi,
  type GoogleApiResponse,
} from "../src/auth/api.js";
import type { GoogleAccessTokenProvider } from "../src/auth/tokens.js";
import { MemoryGoogleAccountRepository } from "../src/auth/account-store.js";
import { GoogleFormsApiClient, type GoogleFormsApi } from "../src/forms/client.js";
import {
  DEFAULT_M2_IMPORT_LIMITS,
  M2_IMPORT_MAX_BYTES,
  M2_IMPORT_MAX_RESPONSES,
  M2_IMPORT_TIMEOUT_MS,
  type M2ImportLimits,
} from "../src/forms/limits.js";
import { fetchAllForms, fetchAllResponses } from "../src/forms/pagination.js";
import { GoogleFormNormalizer, GoogleResponseNormalizer } from "../src/forms/normalizer.js";
import { FormImportService, MemoryFormImportStore } from "../src/forms/service.js";
import type {
  RawDriveFileList,
  RawGoogleForm,
  RawGoogleFormResponse,
  RawGoogleFormResponsePage,
} from "../src/forms/google-types.js";
import type { SafeLogger } from "../src/rpc/logger.js";
import { sidecarError } from "../src/errors.js";

const account = (id = "account-1"): GoogleAccount => ({
  id: id as GoogleAccountId,
  subject: `subject-${id}`,
  email: `${id}@example.com`,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-01T00:00:00.000Z",
});

const logger: SafeLogger = { info: vi.fn(), error: vi.fn() };

const accessTokens: GoogleAccessTokenProvider = {
  getAccessToken: vi.fn(async () => "access-token"),
  forceRefresh: vi.fn(async () => "fresh-token"),
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const choiceForm = (
  options: readonly Record<string, unknown>[],
  formId = "choice-form",
): RawGoogleForm => ({
  formId,
  info: { title: "Choice form" },
  items: [
    {
      itemId: "choice-item",
      title: "Choice",
      questionItem: {
        question: {
          questionId: "choice-question",
          choiceQuestion: { type: "RADIO", options },
        },
      },
    },
  ],
});

const routeChoiceForm = (): RawGoogleForm => ({
  formId: "route-form",
  info: { title: "Route form" },
  items: [
    {
      itemId: "route-item",
      title: "Route",
      questionItem: {
        question: {
          questionId: "route-question",
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "Branch", goToSectionId: "details" },
              { value: "Branch", goToSectionId: "details" },
            ],
          },
        },
      },
    },
    { itemId: "details", title: "Details", pageBreakItem: {} },
  ],
});

const textForm = (formId = "text-form"): RawGoogleForm => ({
  formId,
  info: { title: "Text form" },
  items: [
    {
      itemId: "text-item",
      title: "Comment",
      questionItem: {
        question: { questionId: "text-question", textQuestion: {} },
      },
    },
  ],
});

const responseWithText = (responseId: string, value?: string): RawGoogleFormResponse => ({
  responseId,
  ...(value === undefined
    ? {}
    : { answers: { "choice-question": { textAnswers: { answers: [{ value }] } } } }),
});

const responseForQuestion = (
  responseId: string,
  questionId: string,
  value: string,
): RawGoogleFormResponse => ({
  responseId,
  answers: { [questionId]: { textAnswers: { answers: [{ value }] } } },
});

const branchingRestartForm = (): RawGoogleForm => ({
  formId: "restart-form",
  info: { title: "Restart form" },
  items: [
    {
      itemId: "route-item",
      title: "Route",
      questionItem: {
        question: {
          questionId: "route-question",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "Continue", goToSectionId: "details" },
              { value: "Restart", goToAction: "RESTART_FORM" },
            ],
          },
        },
      },
    },
    { itemId: "details", title: "Details", pageBreakItem: {} },
    {
      itemId: "details-item",
      title: "Detail",
      questionItem: {
        question: { questionId: "details-question", required: true, textQuestion: {} },
      },
    },
  ],
});

const expectBackendCode = async (operation: Promise<unknown>, code: string): Promise<unknown> => {
  const error = await operation.catch((value: unknown) => value);
  expect(error).toMatchObject({ backendError: { code } });
  return error;
};

describe("M2 Drive discovery completeness and pagination", () => {
  it("accepts complete single-page results and all complete pages", async () => {
    const responses = [
      jsonResponse({
        incompleteSearch: false,
        files: [{ id: "form-1", name: "One" }],
        nextPageToken: "page-2",
      }),
      jsonResponse({
        incompleteSearch: false,
        files: [{ id: "form-2", name: "Two" }],
        nextPageToken: "page-3",
      }),
      jsonResponse({
        incompleteSearch: false,
        files: [{ id: "form-3", name: "Three" }],
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
    const client = new GoogleFormsApiClient({ accessTokens, fetchImpl });

    const files = await fetchAllForms(async (cursor) =>
      client.listForms("account-1" as GoogleAccountId, {
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );

    expect(files.map((file) => file.id)).toEqual(["form-1", "form-2", "form-3"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get("pageToken")).toBe(
      "page-2",
    );
    expect(new URL(String(fetchImpl.mock.calls[2]?.[0])).searchParams.get("pageToken")).toBe(
      "page-3",
    );
  });

  it("rejects incomplete search instead of returning an incomplete list", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ incompleteSearch: true, files: [{ id: "form-1", name: "One" }] }),
      );
    const client = new GoogleFormsApiClient({ accessTokens, fetchImpl });

    await expectBackendCode(
      client.listForms("account-1" as GoogleAccountId, {}),
      "GOOGLE_API_ERROR",
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects repeated discovery tokens and mid-pagination failures without partial success", async () => {
    const repeatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ files: [{ id: "form-1", name: "One" }], nextPageToken: "same" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ files: [{ id: "form-2", name: "Two" }], nextPageToken: "same" }),
      );
    const repeatedClient = new GoogleFormsApiClient({
      accessTokens,
      fetchImpl: repeatedFetch,
    });
    await expectBackendCode(
      fetchAllForms(async (cursor) =>
        repeatedClient.listForms("account-1" as GoogleAccountId, {
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
      "GOOGLE_API_ERROR",
    );
    expect(repeatedFetch).toHaveBeenCalledTimes(2);

    const failureFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ files: [{ id: "form-1", name: "One" }], nextPageToken: "next" }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "server failure" }, 500));
    const failureClient = new GoogleFormsApiClient({ accessTokens, fetchImpl: failureFetch });
    await expectBackendCode(
      fetchAllForms(async (cursor) =>
        failureClient.listForms("account-1" as GoogleAccountId, {
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
      "GOOGLE_API_ERROR",
    );
    expect(failureFetch).toHaveBeenCalledTimes(2);
  });

  it("uses file identity for duplicate detection, never title-based deduplication", async () => {
    await expect(
      fetchAllForms(async (cursor) =>
        cursor === undefined
          ? { files: [{ id: "form-1", name: "Same title" }], nextCursor: "next" }
          : { files: [{ id: "form-2", name: "Same title" }] },
      ),
    ).resolves.toHaveLength(2);

    await expect(
      fetchAllForms(async (cursor) =>
        cursor === undefined
          ? { files: [{ id: "form-1", name: "Same title" }], nextCursor: "next" }
          : { files: [{ id: "form-1", name: "Updated title" }] },
      ),
    ).rejects.toMatchObject({ backendError: { code: "GOOGLE_API_ERROR" } });
  });
});

describe("M2 duplicate option and answer-state safety", () => {
  it("maps exactly one normalized option and rejects unknown values", () => {
    const form = new GoogleFormNormalizer().normalize(
      choiceForm([{ value: "  Alpha  " }, { value: "Beta" }]),
      "2026-09-02T00:00:00Z",
    );
    const normalized = new GoogleResponseNormalizer().normalizeAll(form, [
      responseWithText("unique", "Alpha"),
    ]);
    const answer = normalized[0]?.answers["choice-question"];
    expect(answer?.state).toBe("answered");
    if (answer?.state === "answered") expect(answer.value.kind).toBe("single_choice");

    const unknown = new GoogleResponseNormalizer().normalizeAll.bind(
      new GoogleResponseNormalizer(),
    );
    expect(() => unknown(form, [responseWithText("unknown", "Missing")])).toThrow(
      "not in Form options",
    );
  });

  it("rejects duplicate labels without selecting the first OptionKey", async () => {
    const form = new GoogleFormNormalizer().normalize(
      choiceForm([{ value: "Same" }, { value: "Same" }]),
      "2026-09-02T00:00:00Z",
    );
    const question = form.questions[0];
    expect(question?.kind).toBe("single_choice");
    if (question?.kind !== "single_choice") throw new Error("Expected choice question");
    expect(question.options[0]?.key).not.toBe(question.options[1]?.key);
    await expectBackendCode(
      Promise.resolve().then(() =>
        new GoogleResponseNormalizer().normalizeAll(form, [responseWithText("duplicate", "Same")]),
      ),
      "VALIDATION_FAILED",
    );
  });

  it("rejects duplicate labels on route-bearing options before branch resolution", async () => {
    const form = new GoogleFormNormalizer().normalize(routeChoiceForm(), "2026-09-02T00:00:00Z");
    const routeQuestion = form.questions[0];
    if (routeQuestion?.kind !== "single_choice") throw new Error("Expected route question");
    expect(routeQuestion.options.map((option) => option.key)).toHaveLength(2);
    await expectBackendCode(
      Promise.resolve().then(() =>
        new GoogleResponseNormalizer().normalizeAll(form, [
          responseForQuestion("route", "route-question", "Branch"),
        ]),
      ),
      "VALIDATION_FAILED",
    );
  });

  it("does not turn malformed present answers into skipped or indeterminate slots", () => {
    const form = new GoogleFormNormalizer().normalize(
      choiceForm([{ value: "Valid" }]),
      "2026-09-02T00:00:00Z",
    );
    expect(() =>
      new GoogleResponseNormalizer().normalizeAll(form, [
        { responseId: "malformed", answers: { "choice-question": { textAnswers: {} } } },
      ]),
    ).toThrow("Google text answer is invalid");
  });
});

describe("M2 restart-aware path confidence", () => {
  const normalizedRestartForm = (): FormSnapshot =>
    new GoogleFormNormalizer().normalize(branchingRestartForm(), "2026-09-02T00:00:00Z");

  it("keeps restart-capable normal paths at normal confidence", () => {
    const form = normalizedRestartForm();
    const [ordinary, complete] = new GoogleResponseNormalizer().normalizeAll(form, [
      responseForQuestion("ordinary", "route-question", "Continue"),
      {
        responseId: "complete",
        answers: {
          "route-question": { textAnswers: { answers: [{ value: "Continue" }] } },
          "details-question": { textAnswers: { answers: [{ value: "done" }] } },
        },
      },
    ]);
    expect(ordinary?.path.confidence).not.toBe("ambiguous");
    expect(complete?.path.confidence).toBe("certain");
  });

  it("marks selected restart and unresolved restart evidence ambiguous", () => {
    const form = normalizedRestartForm();
    const [selected, unresolved] = new GoogleResponseNormalizer().normalizeAll(form, [
      responseForQuestion("selected", "route-question", "Restart"),
      { responseId: "unresolved", answers: {} },
    ]);
    expect(selected?.path.confidence).toBe("ambiguous");
    expect(unresolved?.path.confidence).toBe("ambiguous");
    expect(unresolved?.answers["details-question"]).toEqual({ state: "indeterminate" });
  });
});

describe("M2 provider payload validation", () => {
  const responseClient = (body: unknown): GoogleFormsApiClient =>
    new GoogleFormsApiClient({
      accessTokens,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
    });

  it.each([
    { name: "numeric token", body: { responses: [], nextPageToken: 7 } },
    { name: "empty token", body: { responses: [], nextPageToken: "" } },
    {
      name: "array response container",
      body: { responses: [{ responseId: "r", answers: [] }] },
    },
    {
      name: "malformed text answer",
      body: { responses: [{ responseId: "r", answers: { q: { textAnswers: {} } } }] },
    },
    {
      name: "malformed file answer",
      body: {
        responses: [{ responseId: "r", answers: { q: { fileUploadAnswers: { answers: [{}] } } } }],
      },
    },
    {
      name: "malformed date/time answer shape",
      body: {
        responses: [{ responseId: "r", answers: { q: { textAnswers: { answers: [null] } } } }],
      },
    },
  ])("rejects present-but-invalid $name", async ({ body }) => {
    await expectBackendCode(
      responseClient(body).listResponses("account-1" as GoogleAccountId, "form-1" as FormId),
      "VALIDATION_FAILED",
    );
  });

  it("accepts omitted optional response fields as absence", async () => {
    await expect(
      responseClient({ responses: [{ responseId: "r" }] }).listResponses(
        "account-1" as GoogleAccountId,
        "form-1" as FormId,
      ),
    ).resolves.toMatchObject({ responses: [{ responseId: "r" }] });
  });
});

describe("M2 Google errors and bounded retry", () => {
  const call = (
    responses: readonly GoogleApiResponse<unknown>[],
    options: Parameters<typeof callGoogleApi>[3] = {},
  ): Promise<unknown> => {
    let index = 0;
    return callGoogleApi(
      "account-1" as GoogleAccountId,
      accessTokens,
      async () => responses[index++] ?? { status: 500, result: {} },
      options,
    );
  };

  it("distinguishes permission denial from quota/rate limiting", async () => {
    await expectBackendCode(
      call(
        [
          {
            status: 403,
            result: { error: { errors: [{ reason: "insufficientFilePermissions" }] } },
          },
        ],
        {
          maxRateLimitRetries: 0,
        },
      ),
      "PERMISSION_DENIED",
    );
    await expectBackendCode(
      call([{ status: 403, result: { error: { errors: [{ reason: "rateLimitExceeded" }] } } }], {
        maxRateLimitRetries: 0,
      }),
      "RATE_LIMITED",
    );
    await expectBackendCode(
      call([{ status: 429, result: {} }], { maxRateLimitRetries: 0 }),
      "RATE_LIMITED",
    );
  });

  it("retries bounded rate limits and stops after exhaustion", async () => {
    const sleep = vi.fn(async () => undefined);
    const request = vi
      .fn<(token: string, signal?: AbortSignal) => Promise<GoogleApiResponse<unknown>>>()
      .mockResolvedValueOnce({ status: 429, result: {} })
      .mockResolvedValueOnce({ status: 200, result: "ok" });
    await expect(
      callGoogleApi("account-1" as GoogleAccountId, accessTokens, request, {
        maxRateLimitRetries: 1,
        rateLimitDelayMs: 0,
        sleep,
      }),
    ).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();

    const exhaustedRequest = vi
      .fn<(token: string, signal?: AbortSignal) => Promise<GoogleApiResponse<unknown>>>()
      .mockResolvedValue({ status: 429, result: {} });
    await expect(
      callGoogleApi("account-1" as GoogleAccountId, accessTokens, exhaustedRequest, {
        maxRateLimitRetries: GOOGLE_RATE_LIMIT_MAX_RETRIES,
        rateLimitDelayMs: 0,
        sleep,
      }),
    ).rejects.toMatchObject({ backendError: { code: "RATE_LIMITED" } });
    expect(exhaustedRequest).toHaveBeenCalledTimes(GOOGLE_RATE_LIMIT_MAX_RETRIES + 1);
  });

  it("keeps 401 refresh exactly once even when rate limiting intervenes", async () => {
    const tokens: GoogleAccessTokenProvider = {
      getAccessToken: vi.fn(async () => "stale"),
      forceRefresh: vi.fn(async () => "fresh"),
    };
    const request = vi
      .fn<(token: string, signal?: AbortSignal) => Promise<GoogleApiResponse<unknown>>>()
      .mockResolvedValueOnce({ status: 401, result: {} })
      .mockResolvedValueOnce({ status: 429, result: {} })
      .mockResolvedValueOnce({ status: 401, result: {} });
    await expect(
      callGoogleApi("account-1" as GoogleAccountId, tokens, request, {
        rateLimitDelayMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ backendError: { code: "UNAUTHENTICATED" } });
    expect(tokens.forceRefresh).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("cancels bounded retry waiting", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(
      (_delayMs: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(sidecarError("JOB_CANCELLED", "cancelled", true)),
            { once: true },
          );
          void resolve;
        }),
    );
    const operation = callGoogleApi(
      "account-1" as GoogleAccountId,
      accessTokens,
      async () => ({ status: 429, result: {} }),
      { signal: controller.signal, sleep },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expectBackendCode(operation, "JOB_CANCELLED");
  });
});

class FakeImportApi implements GoogleFormsApi {
  public form: RawGoogleForm = textForm();
  public readonly responsePages = new Map<
    string | undefined,
    RawGoogleFormResponsePage | Promise<RawGoogleFormResponsePage>
  >();
  public readonly responseCalls: Array<string | undefined> = [];

  public listForms(): Promise<RawDriveFileList> {
    return Promise.resolve({ files: [] });
  }

  public getForm(): Promise<RawGoogleForm> {
    return Promise.resolve(this.form);
  }

  public listResponses(
    _accountId: GoogleAccountId,
    _formId: FormId,
    pageToken?: string,
    _signal?: AbortSignal,
  ): Promise<RawGoogleFormResponsePage> {
    this.responseCalls.push(pageToken);
    const page = this.responsePages.get(pageToken);
    return page === undefined
      ? Promise.reject(sidecarError("GOOGLE_API_ERROR", "page failed", true))
      : Promise.resolve(page);
  }
}

const makeImportService = (
  google: FakeImportApi,
  store = new MemoryFormImportStore(),
  limits: Partial<M2ImportLimits> = {},
  now?: () => number,
) => {
  const first = account();
  const accounts = new MemoryGoogleAccountRepository([first], first.id);
  const service = new FormImportService({ accounts, google, store, logger, limits, now });
  return { accounts, service, store };
};

const validTextPage = (responseId = "r-1"): RawGoogleFormResponsePage => ({
  responses: [{ responseId, answers: {} }],
});

describe("M2 import limits, lifecycle, and cancellation", () => {
  it("centralizes authoritative temporary limits", () => {
    expect(DEFAULT_M2_IMPORT_LIMITS).toEqual({
      maxResponses: M2_IMPORT_MAX_RESPONSES,
      maxBytes: M2_IMPORT_MAX_BYTES,
      timeoutMs: M2_IMPORT_TIMEOUT_MS,
    });
  });

  it("rejects response and cumulative payload limits before storing partial data", async () => {
    const responseLimitApi = new FakeImportApi();
    responseLimitApi.responsePages.set(undefined, {
      responses: Array.from({ length: M2_IMPORT_MAX_RESPONSES + 1 }, (_, index) => ({
        responseId: `r-${index}`,
      })),
    });
    const responseLimit = makeImportService(responseLimitApi);
    await expectBackendCode(
      responseLimit.service.importForm("text-form" as FormId),
      "VALIDATION_FAILED",
    );
    expect(responseLimit.store.get("missing")).toBeNull();

    const payloadLimitApi = new FakeImportApi();
    payloadLimitApi.form = { ...textForm(), payloadBytes: 10 };
    payloadLimitApi.responsePages.set(undefined, { ...validTextPage(), payloadBytes: 1 });
    const payloadLimit = makeImportService(payloadLimitApi, new MemoryFormImportStore(), {
      maxBytes: 10,
    });
    await expectBackendCode(
      payloadLimit.service.importForm("text-form" as FormId),
      "VALIDATION_FAILED",
    );
    expect(payloadLimit.store.get("missing")).toBeNull();
  });

  it("enforces wall time and cleans cancellation state", async () => {
    const timeoutApi = new FakeImportApi();
    let rejectTimeout!: (error: unknown) => void;
    timeoutApi.responsePages.set(
      undefined,
      new Promise<RawGoogleFormResponsePage>((_resolve, reject) => {
        rejectTimeout = reject;
      }),
    );
    const timeoutService = makeImportService(timeoutApi, new MemoryFormImportStore(), {
      timeoutMs: 10,
    });
    const timeoutOperation = timeoutService.service.importForm("text-form" as FormId);
    const timeoutExpectation = expectBackendCode(timeoutOperation, "VALIDATION_FAILED");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    rejectTimeout(sidecarError("JOB_CANCELLED", "cancelled", true));
    await timeoutExpectation;

    const cancelApi = new FakeImportApi();
    cancelApi.responsePages.set(undefined, {
      responses: [{ responseId: "r-1", answers: {} }],
      nextPageToken: "next",
    });
    let rejectPage!: (error: unknown) => void;
    cancelApi.responsePages.set(
      "next",
      new Promise<RawGoogleFormResponsePage>((_resolve, reject) => {
        rejectPage = reject;
      }),
    );
    const cancelService = makeImportService(cancelApi);
    const controller = new AbortController();
    const cancelledOperation = cancelService.service.importForm(
      "text-form" as FormId,
      controller.signal,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    rejectPage(sidecarError("JOB_CANCELLED", "cancelled", true));
    await expectBackendCode(cancelledOperation, "JOB_CANCELLED");
    expect(cancelService.store.get("missing")).toBeNull();

    cancelApi.responsePages.set(undefined, validTextPage("r-2"));
    await expect(cancelService.service.importForm("text-form" as FormId)).resolves.toMatchObject({
      responseCount: 1,
    });
  });

  it("replaces previous pending data and clears it on account context change", async () => {
    const google = new FakeImportApi();
    google.responsePages.set(undefined, validTextPage());
    const setup = makeImportService(google);
    const first = await setup.service.importForm("text-form" as FormId);
    expect(setup.store.get(first.importId)).not.toBeNull();

    google.responsePages.set(undefined, { responses: [{ responseId: "r-2", answers: {} }] });
    const second = await setup.service.importForm("text-form" as FormId);
    expect(setup.store.get(first.importId)).toBeNull();
    expect(setup.store.get(second.importId)).not.toBeNull();

    await setup.accounts.upsert(account("account-2"));
    await setup.accounts.setLastAccountId("account-2" as GoogleAccountId);
    await setup.service.listForms({});
    expect(setup.store.get(second.importId)).toBeNull();
  });
});

describe("M2 response pagination cancellation", () => {
  it("stops future pages and returns controlled cancellation", async () => {
    const controller = new AbortController();
    const calls: Array<string | undefined> = [];
    const operation = fetchAllResponses(async (pageToken, signal) => {
      calls.push(pageToken);
      if (pageToken === undefined) return { responses: [], nextPageToken: "next" };
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(sidecarError("JOB_CANCELLED", "cancelled", true)),
          { once: true },
        );
        void resolve;
      });
      return { responses: [] };
    }, controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expectBackendCode(operation, "JOB_CANCELLED");
    expect(calls).toEqual([undefined, "next"]);
  });
});
