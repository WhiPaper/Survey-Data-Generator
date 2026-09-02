import type { GoogleAccountId } from "@survey-synth/domain";

import { isSidecarError, sidecarError } from "../errors.js";
import type { GoogleAccessTokenProvider } from "./tokens.js";

export interface GoogleApiResponse<T> {
  readonly status: number;
  readonly result: T;
}

export type GoogleApiRequest<T> = (accessToken: string) => Promise<GoogleApiResponse<T>>;

export const callGoogleApi = async <T>(
  accountId: GoogleAccountId,
  accessTokens: GoogleAccessTokenProvider,
  request: GoogleApiRequest<T>,
): Promise<T> => {
  const first = await callRequest(request, await accessTokens.getAccessToken(accountId));
  if (first.status !== 401) return handleResponse(first);

  const second = await callRequest(request, await accessTokens.forceRefresh(accountId));
  if (second.status === 401) {
    throw sidecarError("UNAUTHENTICATED", "Google authentication failed", true);
  }
  return handleResponse(second);
};

const callRequest = async <T>(
  request: GoogleApiRequest<T>,
  accessToken: string,
): Promise<GoogleApiResponse<T>> => {
  try {
    return await request(accessToken);
  } catch (error: unknown) {
    if (isSidecarError(error)) throw error;
    throw sidecarError("GOOGLE_API_ERROR", "Google request failed", true);
  }
};

const handleResponse = <T>(response: GoogleApiResponse<T>): T => {
  if (response.status >= 200 && response.status < 300) return response.result;
  if (response.status === 403) {
    throw sidecarError("PERMISSION_DENIED", "Google permission was denied", true);
  }
  if (response.status === 429) {
    throw sidecarError("RATE_LIMITED", "Google rate limit reached", true);
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
