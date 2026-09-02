import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sidecarError } from "../errors.js";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly authUri: string;
  readonly tokenUri: string;
  readonly userInfoUri: string;
  readonly revokeUri: string;
}

export type GoogleOAuthConfigProvider = () => Promise<GoogleOAuthConfig>;

interface InstalledClientConfig {
  installed?: {
    client_id?: unknown;
    client_secret?: unknown;
    auth_uri?: unknown;
    token_uri?: unknown;
  };
}

const DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_USER_INFO_URI = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_REVOKE_URI = "https://oauth2.googleapis.com/revoke";

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const googleEndpoint = (
  value: unknown,
  fallback: string,
  allowed: readonly { host: string; path: string }[],
): string => {
  if (value === undefined) return fallback;
  if (!nonEmpty(value)) {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth configuration is invalid", true);
  }
  const endpoint = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth configuration is invalid", true);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !allowed.some(({ host, path }) => parsed.hostname === host && parsed.pathname === path)
  ) {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth configuration is invalid", true);
  }
  return endpoint;
};

const parseConfigFile = (raw: unknown): GoogleOAuthConfig => {
  if (typeof raw !== "object" || raw === null || !("installed" in raw)) {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth configuration is invalid", true);
  }
  const installed = (raw as InstalledClientConfig).installed;
  if (installed === undefined || !nonEmpty(installed.client_id)) {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth client ID is not configured", true);
  }
  return {
    clientId: installed.client_id,
    ...(nonEmpty(installed.client_secret) ? { clientSecret: installed.client_secret } : {}),
    authUri: googleEndpoint(installed.auth_uri, DEFAULT_AUTH_URI, [
      { host: "accounts.google.com", path: "/o/oauth2/auth" },
      { host: "accounts.google.com", path: "/o/oauth2/v2/auth" },
    ]),
    tokenUri: googleEndpoint(installed.token_uri, DEFAULT_TOKEN_URI, [
      { host: "oauth2.googleapis.com", path: "/token" },
      { host: "www.googleapis.com", path: "/oauth2/v4/token" },
    ]),
    userInfoUri: DEFAULT_USER_INFO_URI,
    revokeUri: DEFAULT_REVOKE_URI,
  };
};

export const loadGoogleOAuthConfig = async (): Promise<GoogleOAuthConfig> => {
  const clientId = process.env.SURVEY_SYNTH_GOOGLE_CLIENT_ID?.trim();
  if (clientId !== undefined && clientId.length > 0) {
    const clientSecret = process.env.SURVEY_SYNTH_GOOGLE_CLIENT_SECRET?.trim();
    return {
      clientId,
      ...(clientSecret === undefined || clientSecret.length === 0 ? {} : { clientSecret }),
      authUri: DEFAULT_AUTH_URI,
      tokenUri: DEFAULT_TOKEN_URI,
      userInfoUri: DEFAULT_USER_INFO_URI,
      revokeUri: DEFAULT_REVOKE_URI,
    };
  }

  const path =
    process.env.SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG?.trim() ??
    join(process.cwd(), "google_oauth.local.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw sidecarError("VALIDATION_FAILED", "Google OAuth client ID is not configured", true);
  }
  try {
    return parseConfigFile(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "SidecarError") throw error;
    throw sidecarError("VALIDATION_FAILED", "Google OAuth configuration is invalid", true);
  }
};
