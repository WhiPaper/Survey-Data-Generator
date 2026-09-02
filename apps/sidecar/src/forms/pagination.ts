import { sidecarError } from "../errors.js";
import { DEFAULT_M2_IMPORT_LIMITS, M2ImportSafetyBudget, providerPayloadBytes } from "./limits.js";
import type {
  RawDriveFile,
  RawDriveFileList,
  RawGoogleFormResponse,
  RawGoogleFormResponsePage,
} from "./google-types.js";

const MAX_RESPONSE_PAGES = 1_000;
const MAX_FORM_PAGES = 1_000;

export type ResponsePageFetcher = (
  pageToken?: string,
  signal?: AbortSignal,
) => Promise<RawGoogleFormResponsePage>;

export type FormPageFetcher = (cursor?: string, signal?: AbortSignal) => Promise<RawDriveFileList>;

export interface PaginationOptions {
  readonly signal?: AbortSignal;
  readonly budget?: M2ImportSafetyBudget;
}

type OptionsOrSignal = AbortSignal | PaginationOptions | undefined;

export const fetchAllResponses = async (
  fetchPage: ResponsePageFetcher,
  optionsOrSignal?: OptionsOrSignal,
): Promise<RawGoogleFormResponse[]> => {
  const options = normalizeOptions(optionsOrSignal);
  const budget = options.budget ?? new M2ImportSafetyBudget(DEFAULT_M2_IMPORT_LIMITS);
  const responses: RawGoogleFormResponse[] = [];
  const seenTokens = new Set<string>();
  const seenResponseIds = new Set<string>();
  let pageToken: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_RESPONSE_PAGES; pageNumber += 1) {
    budget.check(options.signal);
    if (pageToken !== undefined) {
      if (seenTokens.has(pageToken)) {
        throw paginationError("Google response pagination did not advance");
      }
      seenTokens.add(pageToken);
    }
    const page = await fetchPage(pageToken, options.signal);
    budget.check(options.signal);
    if (!Array.isArray(page.responses)) {
      throw paginationError("Google response page is invalid");
    }
    budget.addPayload(providerPayloadBytes(page), options.signal);
    budget.addResponses(page.responses.length, options.signal);
    for (const response of page.responses) {
      if (seenResponseIds.has(response.responseId)) {
        throw paginationError("Google response pagination returned duplicate responses");
      }
      seenResponseIds.add(response.responseId);
      responses.push(response);
    }

    const nextPageToken = page.nextPageToken;
    if (
      nextPageToken !== undefined &&
      (typeof nextPageToken !== "string" || nextPageToken.length === 0)
    ) {
      throw paginationError("Google response pagination token is invalid");
    }
    if (nextPageToken === undefined) return responses;
    if (seenTokens.has(nextPageToken)) {
      throw paginationError("Google response pagination did not advance");
    }
    pageToken = nextPageToken;
  }

  throw paginationError("Google response pagination exceeded its safety limit");
};

export const fetchAllForms = async (
  fetchPage: FormPageFetcher,
  optionsOrSignal?: OptionsOrSignal,
): Promise<RawDriveFile[]> => {
  const options = normalizeOptions(optionsOrSignal);
  const files: RawDriveFile[] = [];
  const seenTokens = new Set<string>();
  const seenFileIds = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_FORM_PAGES; pageNumber += 1) {
    throwIfCancelled(options.signal);
    if (cursor !== undefined) {
      if (seenTokens.has(cursor)) throw paginationError("Google Form discovery did not advance");
      seenTokens.add(cursor);
    }
    const page = await fetchPage(cursor, options.signal);
    throwIfCancelled(options.signal);
    if (!Array.isArray(page.files)) throw paginationError("Google Form discovery page is invalid");
    if (page.incompleteSearch === true) {
      throw paginationError("Google Drive search was incomplete");
    }
    for (const file of page.files) {
      if (seenFileIds.has(file.id)) {
        throw paginationError("Google Form discovery returned duplicate Forms");
      }
      seenFileIds.add(file.id);
      files.push(file);
    }
    const nextCursor = page.nextCursor;
    if (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.length === 0)) {
      throw paginationError("Google Form discovery continuation is invalid");
    }
    if (nextCursor === undefined) return files;
    if (seenTokens.has(nextCursor)) throw paginationError("Google Form discovery did not advance");
    cursor = nextCursor;
  }

  throw paginationError("Google Form discovery exceeded its safety limit");
};

const normalizeOptions = (value: OptionsOrSignal): PaginationOptions => {
  if (value === undefined) return {};
  if (value instanceof AbortSignal) return { signal: value };
  return value;
};

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw sidecarError("JOB_CANCELLED", "Form import was cancelled", true);
};

const paginationError = (message: string): ReturnType<typeof sidecarError> =>
  sidecarError("GOOGLE_API_ERROR", message, true);
