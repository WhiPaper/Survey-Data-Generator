import type { GoogleAccountId } from "@survey-synth/domain";

import { isSidecarError, sidecarError } from "../errors.js";
import type { GoogleAccessTokenProvider } from "./tokens.js";

export const GOOGLE_RATE_LIMIT_MAX_RETRIES = 2;
export const GOOGLE_RATE_LIMIT_RETRY_DELAY_MS = 250;

export interface GoogleApiResponse<T> {
  readonly status: number;
  readonly result: T;
}

export type GoogleApiRequest<T> = (
  accessToken: string,
  signal?: AbortSignal,
) => Promise<GoogleApiResponse<T>>;

export interface GoogleApiCallOptions {
  readonly signal?: AbortSignal;
  readonly maxRateLimitRetries?: number;
  readonly rateLimitDelayMs?: number;
  readonly sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export const callGoogleApi = async <T>(
  accountId: GoogleAccountId,
  accessTokens: GoogleAccessTokenProvider,
  request: GoogleApiRequest<T>,
  options: GoogleApiCallOptions = {},
): Promise<T> => {
  const requestedRetries = Math.floor(options.maxRateLimitRetries ?? GOOGLE_RATE_LIMIT_MAX_RETRIES);
  const maxRateLimitRetries = Number.isFinite(requestedRetries)
    ? Math.min(GOOGLE_RATE_LIMIT_MAX_RETRIES, Math.max(0, requestedRetries))
    : GOOGLE_RATE_LIMIT_MAX_RETRIES;
  const requestedDelay = Math.floor(options.rateLimitDelayMs ?? GOOGLE_RATE_LIMIT_RETRY_DELAY_MS);
  const rateLimitDelayMs = Number.isFinite(requestedDelay)
    ? Math.min(GOOGLE_RATE_LIMIT_RETRY_DELAY_MS, Math.max(0, requestedDelay))
    : GOOGLE_RATE_LIMIT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? sleepWithCancellation;
  throwIfCancelled(options.signal);
  let accessToken = await accessTokens.getAccessToken(accountId);
  throwIfCancelled(options.signal);
  let forcedRefresh = false;
  let rateLimitRetries = 0;

  for (;;) {
    throwIfCancelled(options.signal);
    const response = await callRequest(request, accessToken, options.signal);
    if (response.status === 401) {
      if (forcedRefresh) {
        throw sidecarError("UNAUTHENTICATED", "Google authentication failed", true);
      }
      forcedRefresh = true;
      accessToken = await accessTokens.forceRefresh(accountId);
      throwIfCancelled(options.signal);
      continue;
    }
    if (isRateLimited(response)) {
      if (rateLimitRetries >= maxRateLimitRetries) return handleResponse(response);
      rateLimitRetries += 1;
      await sleep(rateLimitDelayMs, options.signal);
      continue;
    }
    return handleResponse(response);
  }
};

const callRequest = async <T>(
  request: GoogleApiRequest<T>,
  accessToken: string,
  signal: AbortSignal | undefined,
): Promise<GoogleApiResponse<T>> => {
  try {
    return await (signal === undefined ? request(accessToken) : request(accessToken, signal));
  } catch (error: unknown) {
    if (signal?.aborted) throw sidecarError("JOB_CANCELLED", "Google request was cancelled", true);
    if (isSidecarError(error)) throw error;
    throw sidecarError("GOOGLE_API_ERROR", "Google request failed", true);
  }
};

const isRateLimited = <T>(response: GoogleApiResponse<T>): boolean => {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return providerReasons(response.result).some((reason) => RATE_LIMIT_REASONS.has(reason));
};

const RATE_LIMIT_REASONS = new Set([
  "backenderror",
  "dailylimitexceeded",
  "quotaexceeded",
  "ratelimitexceeded",
  "resourcelimitexceeded",
  "resource_exhausted",
  "resourceexhausted",
  "userratelimitexceeded",
]);

const providerReasons = (value: unknown): string[] => {
  const body = isRecord(value) && isRecord(value.body) ? value.body : value;
  if (!isRecord(body)) return [];
  const error = body.error;
  const reasons: string[] = [];
  if (isRecord(error)) {
    addReason(reasons, error.reason);
    addReason(reasons, error.status);
    if (Array.isArray(error.errors)) {
      for (const item of error.errors) {
        if (isRecord(item)) addReason(reasons, item.reason);
      }
    }
  }
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (isRecord(item)) addReason(reasons, item.reason);
    }
  }
  return reasons;
};

const addReason = (reasons: string[], value: unknown): void => {
  if (typeof value === "string") reasons.push(value.toLowerCase().replaceAll("-", ""));
};

const handleResponse = <T>(response: GoogleApiResponse<T>): T => {
  if (response.status >= 200 && response.status < 300) return response.result;
  if (isRateLimited(response)) {
    throw sidecarError("RATE_LIMITED", "Google rate limit reached", true);
  }
  if (response.status === 403) {
    throw sidecarError("PERMISSION_DENIED", "Google permission was denied", true);
  }
  if (response.status === 404) {
    throw sidecarError(
      "NOT_FOUND",
      "Google resource was not found or is no longer accessible",
      true,
    );
  }
  throw sidecarError("GOOGLE_API_ERROR", "Google request failed", true);
};

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw sidecarError("JOB_CANCELLED", "Google request was cancelled", true);
};

const sleepWithCancellation = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  throwIfCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(sidecarError("JOB_CANCELLED", "Google request was cancelled", true));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
