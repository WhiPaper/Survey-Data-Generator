import { randomUUID } from "node:crypto";

import type {
  FormId,
  FormSnapshot,
  GoogleAccountId,
  NormalizedResponse,
} from "@survey-synth/domain";
import {
  FormImportSummarySchema,
  FormsListResultSchema,
  type FormImportSummary,
  type FormsListParams,
  type FormsListResult,
} from "@survey-synth/contracts";

import { isSidecarError, sidecarError } from "../errors.js";
import type { GoogleAccountRepository } from "../auth/account-store.js";
import type { SafeLogger } from "../rpc/logger.js";
import type { GoogleFormsApi } from "./client.js";
import type { RawGoogleFormResponse } from "./google-types.js";
import {
  DEFAULT_M2_IMPORT_LIMITS,
  m2ImportLimitError,
  M2ImportSafetyBudget,
  providerPayloadBytes,
  type M2ImportLimits,
} from "./limits.js";
import { fetchAllResponses } from "./pagination.js";
import { GoogleFormNormalizer, GoogleResponseNormalizer } from "./normalizer.js";

export interface FormImportSession {
  readonly importId: string;
  readonly accountId: GoogleAccountId;
  readonly form: FormSnapshot;
  readonly responses: readonly NormalizedResponse[];
}

export interface FormImportStore {
  save(session: FormImportSession): void;
  get(importId: string): FormImportSession | null;
  clear(): void;
}

export class MemoryFormImportStore implements FormImportStore {
  private session: FormImportSession | null = null;

  public save(session: FormImportSession): void {
    this.session = session;
  }

  public get(importId: string): FormImportSession | null {
    return this.session?.importId === importId ? this.session : null;
  }

  public clear(): void {
    this.session = null;
  }
}

export interface FormImportServiceOptions {
  readonly accounts: GoogleAccountRepository;
  readonly google: GoogleFormsApi;
  readonly logger: SafeLogger;
  readonly store?: FormImportStore;
  readonly now?: () => number;
  readonly limits?: Partial<M2ImportLimits>;
  readonly formNormalizer?: GoogleFormNormalizer;
  readonly responseNormalizer?: GoogleResponseNormalizer;
}

interface ImportOperation {
  readonly signal: AbortSignal;
  readonly termination: Promise<never>;
  readonly deadlineExceeded: () => boolean;
  readonly cancelled: () => boolean;
  readonly cancel: () => void;
  readonly dispose: () => void;
}

export class FormImportService {
  private readonly store: FormImportStore;
  private readonly now: () => number;
  private readonly limits: M2ImportLimits;
  private readonly formNormalizer: GoogleFormNormalizer;
  private readonly responseNormalizer: GoogleResponseNormalizer;
  private readonly activeImportCancellers = new Set<() => void>();
  private contextAccountId: GoogleAccountId | undefined;

  public constructor(private readonly options: FormImportServiceOptions) {
    this.store = options.store ?? new MemoryFormImportStore();
    this.now = options.now ?? Date.now;
    this.limits = { ...DEFAULT_M2_IMPORT_LIMITS, ...options.limits };
    this.formNormalizer = options.formNormalizer ?? new GoogleFormNormalizer();
    this.responseNormalizer = options.responseNormalizer ?? new GoogleResponseNormalizer();
  }

  public async listForms(params: FormsListParams, signal?: AbortSignal): Promise<FormsListResult> {
    const accountId = await this.activeAccountId();
    try {
      const page = await this.options.google.listForms(accountId, params, signal);
      return FormsListResultSchema.parse({
        items: page.files.map((file) => ({
          formId: file.id,
          title: file.name,
          ...(file.modifiedTime === undefined ? {} : { modifiedAt: file.modifiedTime }),
        })),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      });
    } catch (error: unknown) {
      if (isSidecarError(error)) throw error;
      throw sidecarError("GOOGLE_API_ERROR", "Google Forms could not be listed", true);
    }
  }

  public async importForm(formId: FormId, signal?: AbortSignal): Promise<FormImportSummary> {
    const accountId = await this.activeAccountId();
    const startedAt = this.now();
    const budget = new M2ImportSafetyBudget(this.limits, this.now, startedAt);
    const operation = createImportOperation(signal, this.limits.timeoutMs);
    this.activeImportCancellers.add(operation.cancel);

    const rawFormPromise = this.options.google
      .getForm(accountId, formId, operation.signal)
      .then((rawForm) => {
        budget.addPayload(providerPayloadBytes(rawForm), operation.signal);
        return rawForm;
      });
    let rawResponsesPromise: Promise<RawGoogleFormResponse[]> | undefined;

    try {
      const rawForm = await Promise.race([rawFormPromise, operation.termination]);
      ensureDeadline(operation, budget);
      const form = this.formNormalizer.normalize(rawForm, new Date(startedAt).toISOString());
      ensureDeadline(operation, budget);
      if (form.formId !== formId) {
        throw sidecarError(
          "GOOGLE_API_ERROR",
          "Google Form identity did not match selection",
          true,
        );
      }
      rawResponsesPromise = fetchAllResponses(
        (pageToken, pageSignal) =>
          this.options.google.listResponses(accountId, formId, pageToken, pageSignal),
        { signal: operation.signal, budget },
      );
      const rawResponses = await Promise.race([rawResponsesPromise, operation.termination]);
      ensureDeadline(operation, budget);
      if (rawResponses.length === 0) {
        throw sidecarError("VALIDATION_FAILED", "선택한 Google Form에 응답이 없습니다", true);
      }
      const responses = this.responseNormalizer.normalizeAll(form, rawResponses);
      ensureDeadline(operation, budget);
      const latestAccountId = await this.options.accounts.getLastAccountId();
      if (latestAccountId !== accountId) {
        throw cancelledError();
      }
      const importId = randomUUID();
      this.store.save({ importId, accountId, form, responses });
      const unsupportedQuestionCount = form.questions.filter(
        (question) => question.kind === "unsupported",
      ).length;
      const summary = FormImportSummarySchema.parse({
        importId,
        formId: form.formId,
        title: form.title,
        responseCount: responses.length,
        questionCount: form.questions.length,
        ...(unsupportedQuestionCount === 0 ? {} : { unsupportedQuestionCount }),
      });
      this.options.logger.info("form_import_success", {
        responses: responses.length,
        questions: form.questions.length,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return summary;
    } catch (error: unknown) {
      const normalizedError = importFailure(error, operation, signal, budget, this.now);
      operation.cancel();
      void Promise.allSettled([
        rawFormPromise,
        ...(rawResponsesPromise === undefined ? [] : [rawResponsesPromise]),
      ]);
      this.options.logger.error("form_import_failed", {
        errorCode: normalizedError.backendError.code,
      });
      throw normalizedError;
    } finally {
      operation.dispose();
      this.activeImportCancellers.delete(operation.cancel);
    }
  }

  public getImport(importId: string): FormImportSession | null {
    return this.store.get(importId);
  }

  public clearStoredImport(): void {
    this.store.clear();
  }

  public cancelImports(): void {
    for (const cancel of this.activeImportCancellers) cancel();
  }

  private async activeAccountId(): Promise<GoogleAccountId> {
    const accountId = await this.options.accounts.getLastAccountId();
    if (accountId === null) {
      this.contextAccountId = undefined;
      this.store.clear();
      throw sidecarError("UNAUTHENTICATED", "Google account is not signed in", true);
    }
    if (this.contextAccountId !== undefined && this.contextAccountId !== accountId) {
      this.store.clear();
    }
    this.contextAccountId = accountId;
    return accountId;
  }
}

const createImportOperation = (
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): ImportOperation => {
  const controller = new AbortController();
  let rejectTermination!: (error: unknown) => void;
  const termination = new Promise<never>((_resolve, reject) => {
    rejectTermination = reject;
  });
  void termination.catch(() => undefined);
  let deadlineExceeded = false;
  let cancelled = externalSignal?.aborted ?? false;
  const onExternalAbort = (): void => {
    cancelled = true;
    controller.abort();
    rejectTermination(cancelledError());
  };
  if (externalSignal !== undefined) {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    if (externalSignal.aborted) onExternalAbort();
  }
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort();
    rejectTermination(m2ImportLimitError("time_limit"));
  }, timeoutMs);
  const cancel = (): void => {
    cancelled = true;
    controller.abort();
    rejectTermination(cancelledError());
  };
  return {
    signal: controller.signal,
    termination,
    deadlineExceeded: () => deadlineExceeded,
    cancelled: () => cancelled,
    cancel,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
};

const ensureDeadline = (operation: ImportOperation, budget: M2ImportSafetyBudget): void => {
  if (operation.deadlineExceeded()) throw m2ImportLimitError("time_limit");
  budget.check(operation.signal);
};

const importFailure = (
  error: unknown,
  operation: ImportOperation,
  externalSignal: AbortSignal | undefined,
  budget: M2ImportSafetyBudget,
  now: () => number,
): ReturnType<typeof sidecarError> => {
  if (operation.deadlineExceeded() || now() >= budget.deadlineAt) {
    return m2ImportLimitError("time_limit");
  }
  if (operation.cancelled() || externalSignal?.aborted) return cancelledError();
  if (isSidecarError(error)) return error;
  return sidecarError("GOOGLE_API_ERROR", "Google Form could not be imported", true);
};

const cancelledError = (): ReturnType<typeof sidecarError> =>
  sidecarError("JOB_CANCELLED", "Form import was cancelled", true);
