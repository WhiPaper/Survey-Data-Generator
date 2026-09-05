import { drive } from "@googleapis/drive";
import { forms } from "@googleapis/forms";

import type { FormsListParams, FormsListResult } from "@survey-synth/contracts";
import type { FormId, GoogleAccountId } from "@survey-synth/domain";

import type { GoogleAuthService } from "../auth/service";
import { BackendFailure, backendFailure } from "../errors";

const FORM_MIME_TYPE = "application/vnd.google-apps.form";
const DRIVE_PAGE_SIZE = 100;
const RESPONSE_PAGE_SIZE = 5_000;

export interface GoogleFormsClient {
  listForms(
    accountId: GoogleAccountId,
    params: FormsListParams,
    signal?: AbortSignal,
  ): Promise<FormsListResult>;
  getForm(accountId: GoogleAccountId, formId: FormId, signal?: AbortSignal): Promise<unknown>;
  getAllResponses(
    accountId: GoogleAccountId,
    formId: FormId,
    signal?: AbortSignal,
  ): Promise<unknown[]>;
}

export type CreateGoogleFormsClientOptions = {
  auth: GoogleAuthService;
};

const googleStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } }).response?.status;

const googleFailure = (error: unknown, fallback: string): BackendFailure => {
  if (error instanceof BackendFailure) return error;
  switch (googleStatus(error)) {
    case 401:
      return backendFailure("REAUTH_REQUIRED", "Google authorization expired. Sign in again.");
    case 403:
      return backendFailure("PERMISSION_DENIED", "Google permission was denied");
    case 404:
      return backendFailure("NOT_FOUND", "Google Form was not found");
    case 429:
      return backendFailure("RATE_LIMITED", "Google rate limit was reached");
    default:
      return backendFailure("GOOGLE_API_ERROR", fallback);
  }
};

const cancelled = (): BackendFailure =>
  backendFailure("JOB_CANCELLED", "Google Form operation was cancelled");

const requestOptions = (accessToken: string, signal?: AbortSignal) => ({
  headers: { authorization: `Bearer ${accessToken}` },
  ...(signal ? { signal } : {}),
});

export const createGoogleFormsClient = ({ auth }: CreateGoogleFormsClientOptions): GoogleFormsClient => {
  const request = async <T>(
    accountId: GoogleAccountId,
    action: (accessToken: string) => Promise<T>,
    fallback: string,
  ): Promise<T> => {
    try {
      return await action(await auth.getAccessToken(accountId));
    } catch (error: unknown) {
      if (googleStatus(error) !== 401) throw googleFailure(error, fallback);
    }

    try {
      return await action(await auth.refreshAccessToken(accountId));
    } catch (error: unknown) {
      throw googleFailure(error, fallback);
    }
  };

  return {
    listForms: async (accountId, params, signal) => {
      if (signal?.aborted) throw cancelled();
      const query = params.query?.trim() ?? "";
      const clauses = [`mimeType = '${FORM_MIME_TYPE}'`, "trashed = false"];
      if (query) clauses.push(`name contains '${escapeDriveLiteral(query)}'`);

      const result = await request(
        accountId,
        async (accessToken) => {
          const api = drive({ version: "v3" });
          return api.files.list(
            {
              q: clauses.join(" and "),
              spaces: "drive",
              corpora: "allDrives",
              includeItemsFromAllDrives: true,
              supportsAllDrives: true,
              orderBy: "modifiedTime desc",
              pageSize: DRIVE_PAGE_SIZE,
              pageToken: params.cursor,
              fields: "incompleteSearch,nextPageToken,files(id,name,modifiedTime)",
            },
            requestOptions(accessToken, signal),
          );
        },
        "Google Forms could not be listed",
      );

      if (result.data.incompleteSearch) {
        throw backendFailure("GOOGLE_API_ERROR", "Google Drive search was incomplete");
      }

      return {
        items: (result.data.files ?? []).flatMap((file) =>
          file.id && file.name
            ? [
                {
                  formId: file.id as FormId,
                  title: file.name,
                  ...(file.modifiedTime ? { modifiedAt: file.modifiedTime } : {}),
                },
              ]
            : [],
        ),
        ...(result.data.nextPageToken ? { nextCursor: result.data.nextPageToken } : {}),
      };
    },

    getForm: async (accountId, formId, signal) => {
      if (signal?.aborted) throw cancelled();
      const result = await request(
        accountId,
        async (accessToken) => {
          const api = forms({ version: "v1" });
          return api.forms.get({ formId }, requestOptions(accessToken, signal));
        },
        "Google Form could not be loaded",
      );
      return result.data;
    },

    getAllResponses: async (accountId, formId, signal) => {
      const responses: unknown[] = [];
      const seenTokens = new Set<string>();
      let pageToken: string | undefined;

      do {
        if (signal?.aborted) throw cancelled();
        const result = await request(
          accountId,
          async (accessToken) => {
            const api = forms({ version: "v1" });
            return api.forms.responses.list(
              {
                formId,
                pageSize: RESPONSE_PAGE_SIZE,
                pageToken,
              },
              requestOptions(accessToken, signal),
            );
          },
          "Google Form responses could not be loaded",
        );
        responses.push(...(result.data.responses ?? []));

        const nextToken = result.data.nextPageToken ?? undefined;
        if (nextToken && seenTokens.has(nextToken)) {
          throw backendFailure("GOOGLE_API_ERROR", "Google response pagination did not advance");
        }
        if (nextToken) seenTokens.add(nextToken);
        pageToken = nextToken;
      } while (pageToken);

      return responses;
    },
  };
};

const escapeDriveLiteral = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
