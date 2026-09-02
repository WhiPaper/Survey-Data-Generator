import { sidecarError, type SidecarError } from "../errors.js";
import type { GoogleOAuthConfigProvider } from "./config.js";
import type { GoogleAuthorizationCode } from "./oauth.js";

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly grantedScopes: readonly string[];
}

export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly displayName?: string;
}

export interface GoogleTokenClient {
  exchangeCode(input: GoogleAuthorizationCode): Promise<GoogleTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet>;
  resolveIdentity(accessToken: string): Promise<GoogleIdentity>;
  revokeToken(token: string): Promise<void>;
}

type GoogleProviderErrorKind =
  "invalid_grant" | "unauthorized" | "permission_denied" | "rate_limited" | "api" | "network";

export class GoogleProviderError extends Error {
  public constructor(
    public readonly kind: GoogleProviderErrorKind,
    public readonly status?: number,
  ) {
    super("Google provider request failed");
    this.name = "GoogleProviderError";
  }
}

export interface GoogleHttpClientOptions {
  readonly getConfig: GoogleOAuthConfigProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const optionalString = (value: unknown): string | undefined =>
  value === undefined ? undefined : nonEmptyString(value) ? value : undefined;

const providerErrorKind = (status: number, body: unknown): GoogleProviderErrorKind => {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  if (code === "invalid_grant") return "invalid_grant";
  if (status === 401) return "unauthorized";
  if (status === 403) return isRateLimitedBody(body) ? "rate_limited" : "permission_denied";
  if (status === 429) return "rate_limited";
  return "api";
};

const isRateLimitedBody = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const reasons: unknown[] = [];
  const error = value.error;
  if (typeof error === "string") reasons.push(error);
  if (isRecord(error)) {
    reasons.push(error.reason, error.status);
    if (Array.isArray(error.errors)) {
      for (const item of error.errors) {
        if (isRecord(item)) reasons.push(item.reason);
      }
    }
  }
  if (Array.isArray(value.errors)) {
    for (const item of value.errors) {
      if (isRecord(item)) reasons.push(item.reason);
    }
  }
  return reasons.some(
    (reason) =>
      typeof reason === "string" &&
      [
        "backenderror",
        "dailylimitexceeded",
        "quotaexceeded",
        "ratelimitexceeded",
        "resource_exhausted",
        "resourceexhausted",
        "userratelimitexceeded",
      ].includes(reason.toLowerCase().replaceAll("-", "")),
  );
};

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const parseTokenSet = (body: unknown): GoogleTokenSet => {
  if (!isRecord(body) || !nonEmptyString(body.access_token)) {
    throw new GoogleProviderError("api");
  }
  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 0) {
    throw new GoogleProviderError("api");
  }
  const scope = optionalString(body.scope);
  return {
    accessToken: body.access_token,
    expiresInSeconds: expiresIn,
    ...(optionalString(body.refresh_token) === undefined
      ? {}
      : { refreshToken: optionalString(body.refresh_token) }),
    ...(optionalString(body.id_token) === undefined
      ? {}
      : { idToken: optionalString(body.id_token) }),
    grantedScopes: scope === undefined ? [] : scope.split(/\s+/).filter(nonEmptyString),
  };
};

const formBody = (values: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, value);
  }
  return params.toString();
};

export class GoogleHttpClient implements GoogleTokenClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: GoogleHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  public async exchangeCode(input: GoogleAuthorizationCode): Promise<GoogleTokenSet> {
    const config = await this.options.getConfig();
    const body = await this.postForm(config.tokenUri, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    });
    return parseTokenSet(body);
  }

  public async refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
    const config = await this.options.getConfig();
    const body = await this.postForm(config.tokenUri, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return parseTokenSet(body);
  }

  public async resolveIdentity(accessToken: string): Promise<GoogleIdentity> {
    const config = await this.options.getConfig();
    let response: Response;
    try {
      response = await this.fetchImpl(config.userInfoUri, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleProviderError("network");
    }
    const body = await parseBody(response);
    if (!response.ok)
      throw new GoogleProviderError(providerErrorKind(response.status, body), response.status);
    if (!isRecord(body) || !nonEmptyString(body.sub) || !nonEmptyString(body.email)) {
      throw new GoogleProviderError("api", response.status);
    }
    const displayName = optionalString(body.name);
    return {
      subject: body.sub,
      email: body.email,
      ...(displayName === undefined ? {} : { displayName }),
    };
  }

  public async revokeToken(token: string): Promise<void> {
    const config = await this.options.getConfig();
    let response: Response;
    try {
      response = await this.fetchImpl(config.revokeUri, {
        body: formBody({ token }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleProviderError("network");
    }
    const body = await parseBody(response);
    if (response.ok) return;
    if (
      response.status === 400 &&
      isRecord(body) &&
      (body.error === "invalid_token" || body.error === "invalid_grant")
    ) {
      return;
    }
    throw new GoogleProviderError(providerErrorKind(response.status, body), response.status);
  }

  private async postForm(
    url: string,
    values: Record<string, string | undefined>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        body: formBody(values),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GoogleProviderError("network");
    }
    const body = await parseBody(response);
    if (!response.ok)
      throw new GoogleProviderError(providerErrorKind(response.status, body), response.status);
    return body;
  }
}

export const mapGoogleProviderError = (
  error: unknown,
  fallbackMessage = "Google request failed",
): SidecarError => {
  if (!(error instanceof GoogleProviderError)) {
    return sidecarError("INTERNAL", fallbackMessage, true);
  }
  switch (error.kind) {
    case "invalid_grant":
      return sidecarError("REAUTH_REQUIRED", "Google authentication must be renewed", true);
    case "unauthorized":
      return sidecarError("UNAUTHENTICATED", "Google authentication failed", true);
    case "permission_denied":
      return sidecarError("PERMISSION_DENIED", "Google permission was denied", true);
    case "rate_limited":
      return sidecarError("RATE_LIMITED", "Google rate limit reached", true);
    case "api":
    case "network":
      return sidecarError("GOOGLE_API_ERROR", fallbackMessage, true);
  }
};
