import type { FormId, GoogleAccountId } from "@survey-synth/domain";

import { callGoogleApi } from "../auth/api.js";
import { sidecarError, isSidecarError } from "../errors.js";
import type { GoogleAccessTokenProvider } from "../auth/tokens.js";
import type {
  RawDriveFile,
  RawDriveFileList,
  RawGoogleAnswer,
  RawGoogleForm,
  RawGoogleFormInfo,
  RawGoogleFormResponse,
  RawGoogleFormResponsePage,
  RawGoogleItem,
} from "./google-types.js";

const DRIVE_FILES_URI = "https://www.googleapis.com/drive/v3/files";
const FORMS_URI = "https://forms.googleapis.com/v1/forms";
const FORM_MIME_TYPE = "application/vnd.google-apps.form";
const DEFAULT_TIMEOUT_MS = 15_000;
const DRIVE_PAGE_SIZE = 100;
const RESPONSE_PAGE_SIZE = 5_000;
const DRIVE_CURSOR_PREFIX = "survey-synth-forms-v1.";

export interface FormsListRequest {
  readonly query?: string;
  readonly cursor?: string;
}

export interface GoogleFormsApi {
  listForms(
    accountId: GoogleAccountId,
    request: FormsListRequest,
    signal?: AbortSignal,
  ): Promise<RawDriveFileList>;
  getForm(accountId: GoogleAccountId, formId: FormId, signal?: AbortSignal): Promise<RawGoogleForm>;
  listResponses(
    accountId: GoogleAccountId,
    formId: FormId,
    pageToken?: string,
    signal?: AbortSignal,
  ): Promise<RawGoogleFormResponsePage>;
}

export interface GoogleFormsApiClientOptions {
  readonly accessTokens: GoogleAccessTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface JsonResponse {
  readonly body: unknown;
  readonly payloadBytes: number;
}

interface DriveProviderPage {
  readonly files: readonly RawDriveFile[];
  readonly nextPageToken?: string;
  readonly incompleteSearch: boolean;
  readonly payloadBytes: number;
}

interface DriveCursor {
  readonly query: string;
  readonly pageToken: string;
  readonly seenTokens: readonly string[];
}

export class GoogleFormsApiClient implements GoogleFormsApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: GoogleFormsApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async listForms(
    accountId: GoogleAccountId,
    request: FormsListRequest,
    signal?: AbortSignal,
  ): Promise<RawDriveFileList> {
    const query = normalizedSearchQuery(request.query);
    const cursor = decodeDriveCursor(request.cursor, query);
    const params = new URLSearchParams({
      q: driveQuery(query),
      spaces: "drive",
      corpora: "allDrives",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      orderBy: "modifiedTime desc",
      pageSize: String(DRIVE_PAGE_SIZE),
      fields: "incompleteSearch,nextPageToken,files(id,name,modifiedTime)",
    });
    if (cursor !== undefined) params.set("pageToken", cursor.pageToken);
    const response = await this.requestJson(accountId, `${DRIVE_FILES_URI}?${params}`, signal);
    const page = parseDriveFileList(response.body, response.payloadBytes);
    if (page.incompleteSearch) {
      throw sidecarError("GOOGLE_API_ERROR", "Google Drive search was incomplete", true);
    }
    if (page.nextPageToken !== undefined && cursor?.seenTokens.includes(page.nextPageToken)) {
      throw sidecarError("GOOGLE_API_ERROR", "Google Drive pagination did not advance", true);
    }
    const nextCursor =
      page.nextPageToken === undefined
        ? undefined
        : encodeDriveCursor({
            query,
            pageToken: page.nextPageToken,
            seenTokens: [
              ...(cursor?.seenTokens ?? []),
              ...(cursor === undefined ? [] : [cursor.pageToken]),
              page.nextPageToken,
            ],
          });
    return {
      files: page.files,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      incompleteSearch: false,
      payloadBytes: page.payloadBytes,
    };
  }

  public async getForm(
    accountId: GoogleAccountId,
    formId: FormId,
    signal?: AbortSignal,
  ): Promise<RawGoogleForm> {
    const params = new URLSearchParams({ fields: "formId,info,items" });
    const response = await this.requestJson(
      accountId,
      `${FORMS_URI}/${encodeURIComponent(formId)}?${params}`,
      signal,
    );
    return parseForm(response.body, response.payloadBytes);
  }

  public async listResponses(
    accountId: GoogleAccountId,
    formId: FormId,
    pageToken?: string,
    signal?: AbortSignal,
  ): Promise<RawGoogleFormResponsePage> {
    const params = new URLSearchParams({
      pageSize: String(RESPONSE_PAGE_SIZE),
      fields: "nextPageToken,responses(responseId,createTime,lastSubmittedTime,answers)",
    });
    if (pageToken !== undefined) params.set("pageToken", pageToken);
    const response = await this.requestJson(
      accountId,
      `${FORMS_URI}/${encodeURIComponent(formId)}/responses?${params}`,
      signal,
    );
    return parseResponsePage(response.body, response.payloadBytes);
  }

  private requestJson(
    accountId: GoogleAccountId,
    url: string,
    externalSignal?: AbortSignal,
  ): Promise<JsonResponse> {
    return callGoogleApi(
      accountId,
      this.options.accessTokens,
      async (accessToken, requestSignal) => {
        if (requestSignal?.aborted) throw cancelledError();
        const signal = createRequestSignal(requestSignal, this.timeoutMs);
        try {
          const response = await this.fetchImpl(url, {
            headers: {
              accept: "application/json",
              authorization: `Bearer ${accessToken}`,
            },
            signal: signal.signal,
          });
          return {
            status: response.status,
            result: await parseJson(response),
          };
        } catch (error: unknown) {
          if (isSidecarError(error)) throw error;
          if (requestSignal?.aborted) throw cancelledError();
          if (signal.timedOut) {
            throw sidecarError("GOOGLE_API_ERROR", "Google request timed out", true);
          }
          if (error instanceof Error && error.name === "AbortError") {
            throw sidecarError("GOOGLE_API_ERROR", "Google request failed", true);
          }
          throw sidecarError("GOOGLE_API_ERROR", "Google request failed", true);
        } finally {
          signal.cleanup();
        }
      },
      { signal: externalSignal },
    );
  }
}

const normalizedSearchQuery = (query: string | undefined): string => query?.trim() ?? "";

const driveQuery = (query: string): string => {
  const clauses = [`mimeType = '${FORM_MIME_TYPE}'`, "trashed = false"];
  if (query.length > 0) clauses.push(`name contains '${escapeDriveLiteral(query)}'`);
  return clauses.join(" and ");
};

const escapeDriveLiteral = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const encodeDriveCursor = (cursor: DriveCursor): string =>
  `${DRIVE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;

const decodeDriveCursor = (value: string | undefined, query: string): DriveCursor | undefined => {
  if (value === undefined) return undefined;
  if (!value.startsWith(DRIVE_CURSOR_PREFIX)) throw invalidCursor();
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(DRIVE_CURSOR_PREFIX.length), "base64url").toString("utf8"),
    ) as unknown;
    if (!isRecord(decoded)) throw invalidCursor();
    if (decoded.query !== query || !nonEmptyString(decoded.pageToken)) throw invalidCursor();
    if (
      !Array.isArray(decoded.seenTokens) ||
      decoded.seenTokens.some((token) => !nonEmptyString(token)) ||
      decoded.seenTokens.at(-1) !== decoded.pageToken
    ) {
      throw invalidCursor();
    }
    return {
      query,
      pageToken: decoded.pageToken,
      seenTokens: decoded.seenTokens,
    };
  } catch (error: unknown) {
    if (isSidecarError(error)) throw error;
    throw invalidCursor();
  }
};

const createRequestSignal = (
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: boolean; cleanup: () => void } => {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = (): void => controller.abort();
  if (externalSignal !== undefined)
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
};

const cancelledError = (): ReturnType<typeof sidecarError> =>
  sidecarError("JOB_CANCELLED", "Form import was cancelled", true);

const invalidCursor = (): ReturnType<typeof sidecarError> =>
  sidecarError("VALIDATION_FAILED", "Google Form continuation is invalid", true);

const parseJson = async (response: Response): Promise<JsonResponse> => {
  const text = await response.text();
  const payloadBytes = Buffer.byteLength(text, "utf8");
  if (text.length === 0) return { body: {}, payloadBytes };
  try {
    return { body: JSON.parse(text) as unknown, payloadBytes };
  } catch {
    if (!response.ok) return { body: {}, payloadBytes };
    throw invalidPayload();
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const optionalDescription = (value: Record<string, unknown>, key: string): string | undefined => {
  if (!hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "string") throw invalidPayload();
  return value[key];
};

const requiredOptionalString = (
  value: Record<string, unknown>,
  key: string,
  message: string,
): string | undefined => {
  if (!hasOwn(value, key)) return undefined;
  if (!nonEmptyString(value[key])) throw invalidPayload(message);
  return value[key];
};

const optionalBoolean = (
  value: Record<string, unknown>,
  key: string,
  message: string,
): boolean | undefined => {
  if (!hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "boolean") throw invalidPayload(message);
  return value[key];
};

const invalidPayload = (
  message = "Google returned invalid Form data",
): ReturnType<typeof sidecarError> => sidecarError("VALIDATION_FAILED", message, true);

const parseDriveFile = (value: unknown): RawDriveFile => {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) {
    throw invalidPayload();
  }
  const modifiedTime = requiredOptionalString(
    value,
    "modifiedTime",
    "Google Form metadata is invalid",
  );
  return {
    id: value.id,
    name: value.name,
    ...(modifiedTime === undefined ? {} : { modifiedTime }),
  };
};

const parseDriveFileList = (value: unknown, payloadBytes: number): DriveProviderPage => {
  if (!isRecord(value) || !Array.isArray(value.files)) throw invalidPayload();
  const nextPageToken = requiredOptionalString(
    value,
    "nextPageToken",
    "Google Drive pagination token is invalid",
  );
  const incompleteSearch =
    optionalBoolean(value, "incompleteSearch", "Google Drive completeness flag is invalid") ??
    false;
  return {
    files: value.files.map(parseDriveFile),
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
    incompleteSearch,
    payloadBytes,
  };
};

const parseForm = (value: unknown, payloadBytes: number): RawGoogleForm => {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.formId) ||
    !isRecord(value.info) ||
    !nonEmptyString(value.info.title) ||
    !Array.isArray(value.items) ||
    value.items.some((item) => !isRecord(item))
  ) {
    throw invalidPayload();
  }
  const description = optionalDescription(value.info, "description");
  const documentTitle = optionalDescription(value.info, "documentTitle");
  const info: RawGoogleFormInfo = {
    title: value.info.title,
    ...(description === undefined ? {} : { description }),
    ...(documentTitle === undefined ? {} : { documentTitle }),
  };
  return {
    formId: value.formId,
    info,
    items: value.items as RawGoogleItem[],
    payloadBytes,
  };
};

const parseFormResponse = (value: unknown): RawGoogleFormResponse => {
  if (!isRecord(value) || !nonEmptyString(value.responseId)) throw invalidPayload();
  const answers = value.answers;
  if (hasOwn(value, "answers") && !isRecord(answers)) throw invalidPayload();
  const parsedAnswers: Record<string, RawGoogleAnswer> = {};
  for (const [questionId, answer] of Object.entries(answers ?? {})) {
    if (!nonEmptyString(questionId)) throw invalidPayload("Google response question ID is invalid");
    parsedAnswers[questionId] = parseAnswer(answer, questionId);
  }
  const createTime = requiredOptionalString(value, "createTime", "Google response time is invalid");
  const lastSubmittedTime = requiredOptionalString(
    value,
    "lastSubmittedTime",
    "Google response time is invalid",
  );
  return {
    responseId: value.responseId,
    ...(createTime === undefined ? {} : { createTime }),
    ...(lastSubmittedTime === undefined ? {} : { lastSubmittedTime }),
    ...(hasOwn(value, "answers") ? { answers: parsedAnswers } : {}),
  };
};

const parseAnswer = (value: unknown, questionId: string): RawGoogleAnswer => {
  if (!isRecord(value)) throw invalidPayload("Google response answer is invalid");
  if (hasOwn(value, "questionId") && value.questionId !== questionId) {
    throw invalidPayload("Google response question ID is invalid");
  }
  const hasText = hasOwn(value, "textAnswers");
  const hasFiles = hasOwn(value, "fileUploadAnswers");
  if (hasText === hasFiles) throw invalidPayload("Google response answer shape is invalid");
  if (hasText) return { textAnswers: parseTextAnswers(value.textAnswers) };
  return { fileUploadAnswers: parseFileUploadAnswers(value.fileUploadAnswers) };
};

const parseTextAnswers = (value: unknown): NonNullable<RawGoogleAnswer["textAnswers"]> => {
  if (!isRecord(value) || !hasOwn(value, "answers") || !Array.isArray(value.answers)) {
    throw invalidPayload("Google text answer is invalid");
  }
  if (value.answers.length === 0) throw invalidPayload("Google text answer is invalid");
  return {
    answers: value.answers.map((answer) => {
      if (!isRecord(answer) || typeof answer.value !== "string") {
        throw invalidPayload("Google text answer is invalid");
      }
      return { value: answer.value };
    }),
  };
};

const parseFileUploadAnswers = (
  value: unknown,
): NonNullable<RawGoogleAnswer["fileUploadAnswers"]> => {
  if (!isRecord(value) || !hasOwn(value, "answers") || !Array.isArray(value.answers)) {
    throw invalidPayload("Google file answer is invalid");
  }
  if (value.answers.length === 0) throw invalidPayload("Google file answer is invalid");
  return {
    answers: value.answers.map((answer) => {
      if (!isRecord(answer)) throw invalidPayload("Google file answer is invalid");
      const parsed: {
        fileId?: string;
        fileName?: string;
        mimeType?: string;
      } = {};
      for (const key of ["fileId", "fileName", "mimeType"] as const) {
        if (!hasOwn(answer, key)) continue;
        if (typeof answer[key] !== "string" || (key === "fileId" && answer[key].length === 0)) {
          throw invalidPayload("Google file answer is invalid");
        }
        parsed[key] = answer[key];
      }
      if (Object.keys(parsed).length === 0) throw invalidPayload("Google file answer is invalid");
      return parsed;
    }),
  };
};

const parseResponsePage = (value: unknown, payloadBytes: number): RawGoogleFormResponsePage => {
  if (!isRecord(value)) throw invalidPayload();
  const responses = value.responses;
  if (hasOwn(value, "responses") && !Array.isArray(responses)) throw invalidPayload();
  const responseValues: unknown[] = responses === undefined ? [] : (responses as unknown[]);
  const nextPageToken = requiredOptionalString(
    value,
    "nextPageToken",
    "Google response pagination token is invalid",
  );
  return {
    responses: responseValues.map(parseFormResponse),
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
    payloadBytes,
  };
};
