import { createHash, randomUUID } from "node:crypto";

import type {
  FormId,
  FormImportResult,
  FormsImportParams,
  FormsListParams,
  FormsListResult,
  ProjectSourceRefreshParams,
} from "@survey-synth/contracts";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import type { GoogleAuthService } from "../auth/service";
import { backendFailure } from "../errors";
import type { JobRegistry } from "../jobs";
import type { SurveyDatabase } from "../persistence/database";
import { createImportedProject, createSourceRevision, getProject } from "../persistence/store";
import type { GoogleFormsClient } from "./google-client";
import { invalidValueGroupIdsForForm } from "../value-groups/service";
import { GoogleFormNormalizer, GoogleResponseNormalizer } from "./normalizer";

export interface FormsService {
  listForms(params: FormsListParams): Promise<FormsListResult>;
  importForm(params: FormsImportParams): Promise<FormImportResult>;
  refreshProjectSource(params: ProjectSourceRefreshParams): Promise<{
    projectId: string;
    previousSourceRevisionId: string;
    sourceRevisionId: string;
    invalidValueGroupIds: string[];
  }>;
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
        throw backendFailure(
          "VALIDATION_FAILED",
          "A Form import with this operation ID is already running",
        );
      }

      try {
        const capturedAtMs = now();
        const rawForm = await google.getForm(account.id, params.formId, signal);
        const form = formNormalizer.normalize(rawForm, new Date(capturedAtMs).toISOString());
        if (form.formId !== params.formId) {
          throw backendFailure(
            "GOOGLE_API_ERROR",
            "Google Form identity did not match the selection",
          );
        }

        const rawResponses = await google.getAllResponses(account.id, params.formId, signal);
        if (rawResponses.length === 0) {
          throw backendFailure("VALIDATION_FAILED", "선택한 Google Form에 응답이 없습니다");
        }
        const responses = responseNormalizer.normalizeAll(form, rawResponses);
        if (signal.aborted)
          throw backendFailure("JOB_CANCELLED", "Google Form import was cancelled");

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

    refreshProjectSource: async (params) => {
      const project = getProject(db, params.projectId);
      if (!project) throw backendFailure("NOT_FOUND", "Project was not found");
      if (!project.googleAccountId) {
        throw backendFailure(
          "REAUTH_REQUIRED",
          "The Google account for this project is disconnected",
        );
      }
      if (!project.currentSourceRevisionId) {
        throw backendFailure("VALIDATION_FAILED", "Project has no imported source revision");
      }

      const account = await activeAccount();
      if (String(account.id) !== project.googleAccountId) {
        throw backendFailure(
          "REAUTH_REQUIRED",
          "Switch to the Google account connected to this project before refreshing",
        );
      }

      const operationId = params.operationId ?? randomUUID();
      let signal: AbortSignal;
      try {
        signal = jobs.start(operationId);
      } catch {
        throw backendFailure(
          "VALIDATION_FAILED",
          "A source refresh with this operation ID is already running",
        );
      }

      try {
        const capturedAtMs = now();
        const formId = project.googleFormId as FormId;
        const rawForm = await google.getForm(account.id, formId, signal);
        const form = formNormalizer.normalize(rawForm, new Date(capturedAtMs).toISOString());
        if (String(form.formId) !== project.googleFormId) {
          throw backendFailure(
            "GOOGLE_API_ERROR",
            "Google Form identity did not match the project",
          );
        }

        const rawResponses = await google.getAllResponses(account.id, formId, signal);
        if (rawResponses.length === 0) {
          throw backendFailure("VALIDATION_FAILED", "Google Form has no responses to refresh");
        }
        const responses = responseNormalizer.normalizeAll(form, rawResponses);
        if (signal.aborted)
          throw backendFailure("JOB_CANCELLED", "Google Form refresh was cancelled");

        const latestSession = await auth.getSession();
        if (!latestSession || String(latestSession.account.id) !== project.googleAccountId) {
          throw backendFailure("JOB_CANCELLED", "Google account changed during source refresh");
        }

        const invalidValueGroupIds = invalidValueGroupIdsForForm(db, project.id, form);
        const revision = createSourceRevision(db, {
          projectId: project.id,
          formSnapshot: {
            title: form.title,
            schema: form,
            schemaHash: form.schemaHash,
          },
          responseSetHash: responseSetHash(form, responses),
          responses: responses.map((response) => ({
            responseId: response.responseId,
            submittedAtMs: responseTimestamp(response),
            response,
          })),
          importedAtMs: now(),
        });

        return {
          projectId: project.id,
          previousSourceRevisionId: project.currentSourceRevisionId,
          sourceRevisionId: revision.id,
          invalidValueGroupIds,
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

const responseSetHash = (form: FormSnapshot, responses: readonly NormalizedResponse[]): string => {
  const canonical = [...responses]
    .sort((left, right) => String(left.responseId).localeCompare(String(right.responseId)))
    .map((response) => ({
      responseId: response.responseId,
      createdAt: response.createdAt ?? null,
      lastSubmittedAt: response.lastSubmittedAt ?? null,
      answers: form.questions.map((question) => [
        question.id,
        response.answers[question.id] ?? null,
      ]),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};
