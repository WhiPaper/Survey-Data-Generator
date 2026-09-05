import { createHash, randomUUID } from "node:crypto";

import type {
  FormImportResult,
  FormsImportParams,
  FormsListParams,
  FormsListResult,
} from "@survey-synth/contracts";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import type { GoogleAuthService } from "../auth/service";
import { backendFailure } from "../errors";
import type { JobRegistry } from "../jobs";
import type { SurveyDatabase } from "../persistence/database";
import { createImportedProject } from "../persistence/store";
import type { GoogleFormsClient } from "./google-client";
import { GoogleFormNormalizer, GoogleResponseNormalizer } from "./normalizer";

export interface FormsService {
  listForms(params: FormsListParams): Promise<FormsListResult>;
  importForm(params: FormsImportParams): Promise<FormImportResult>;
  cancelImport(operationId: string): void;
}

export type CreateFormsServiceOptions = {
  auth: GoogleAuthService;
  google: GoogleFormsClient;
  db: SurveyDatabase;
  jobs: JobRegistry;
  now?: () => number;
  formNormalizer?: GoogleFormNormalizer;
  responseNormalizer?: GoogleResponseNormalizer;
};

export const createFormsService = ({
  auth,
  google,
  db,
  jobs,
  now = Date.now,
  formNormalizer = new GoogleFormNormalizer(),
  responseNormalizer = new GoogleResponseNormalizer(),
}: CreateFormsServiceOptions): FormsService => {
  const activeAccount = async () => {
    const session = await auth.getSession();
    if (!session) throw backendFailure("UNAUTHENTICATED", "Google account is not signed in");
    return session.account;
  };

  return {
    listForms: async (params) => {
      const account = await activeAccount();
      return google.listForms(account.id, params);
    },

    importForm: async (params) => {
      const account = await activeAccount();
      const operationId = params.operationId ?? randomUUID();
      let signal: AbortSignal;
      try {
        signal = jobs.start(operationId);
      } catch {
        throw backendFailure("VALIDATION_FAILED", "A Form import with this operation ID is already running");
      }

      try {
        const capturedAtMs = now();
        const rawForm = await google.getForm(account.id, params.formId, signal);
        const form = formNormalizer.normalize(rawForm, new Date(capturedAtMs).toISOString());
        if (form.formId !== params.formId) {
          throw backendFailure("GOOGLE_API_ERROR", "Google Form identity did not match the selection");
        }

        const rawResponses = await google.getAllResponses(account.id, params.formId, signal);
        if (rawResponses.length === 0) {
          throw backendFailure("VALIDATION_FAILED", "선택한 Google Form에 응답이 없습니다");
        }
        const responses = responseNormalizer.normalizeAll(form, rawResponses);
        if (signal.aborted) throw backendFailure("JOB_CANCELLED", "Google Form import was cancelled");

        const latestSession = await auth.getSession();
        if (!latestSession || latestSession.account.id !== account.id) {
          throw backendFailure("JOB_CANCELLED", "Google account changed during Form import");
        }

        const imported = createImportedProject(db, {
          name: form.title,
          googleAccountId: account.id,
          googleFormId: form.formId,
          formSnapshot: {
            title: form.title,
            schema: form,
            schemaHash: form.schemaHash,
            capturedAtMs,
          },
          responseSetHash: responseSetHash(form, responses),
          responses: responses.map((response) => ({
            responseId: response.responseId,
            submittedAtMs: responseTimestamp(response),
            response,
          })),
          importedAtMs: now(),
        });

        const unsupportedQuestionCount = form.questions.filter(
          (question) => question.kind === "unsupported",
        ).length;

        return {
          projectId: imported.project.id,
          sourceRevisionId: imported.revision.id,
          formId: form.formId,
          title: form.title,
          responseCount: responses.length,
          questionCount: form.questions.length,
          ...(unsupportedQuestionCount > 0 ? { unsupportedQuestionCount } : {}),
        };
      } finally {
        jobs.finish(operationId);
      }
    },

    cancelImport: (operationId) => {
      jobs.cancel(operationId);
    },
  };
};

const responseTimestamp = (response: NormalizedResponse): number => {
  const value = response.lastSubmittedAt ?? response.createdAt;
  if (!value) throw backendFailure("VALIDATION_FAILED", "Google response timestamp is missing");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw backendFailure("VALIDATION_FAILED", "Google response timestamp is invalid");
  }
  return timestamp;
};

const responseSetHash = (
  form: FormSnapshot,
  responses: readonly NormalizedResponse[],
): string => {
  const canonical = [...responses]
    .sort((left, right) => String(left.responseId).localeCompare(String(right.responseId)))
    .map((response) => ({
      responseId: response.responseId,
      createdAt: response.createdAt ?? null,
      lastSubmittedAt: response.lastSubmittedAt ?? null,
      answers: form.questions.map((question) => [question.id, response.answers[question.id] ?? null]),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};
