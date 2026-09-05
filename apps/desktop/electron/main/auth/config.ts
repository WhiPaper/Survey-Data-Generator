import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { backendFailure } from "../errors";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret?: string;
};

type InstalledClientFile = {
  installed?: {
    client_id?: unknown;
    client_secret?: unknown;
  };
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseClientFile = (value: unknown): GoogleOAuthConfig => {
  if (typeof value !== "object" || value === null) {
    throw backendFailure("VALIDATION_FAILED", "Google OAuth configuration is invalid");
  }
  const installed = (value as InstalledClientFile).installed;
  if (!installed || !nonEmpty(installed.client_id)) {
    throw backendFailure("VALIDATION_FAILED", "Google OAuth client ID is not configured");
  }
  return {
    clientId: installed.client_id.trim(),
    ...(nonEmpty(installed.client_secret) ? { clientSecret: installed.client_secret.trim() } : {}),
  };
};

export type LoadGoogleOAuthConfigOptions = {
  appPath: string;
};

export const loadGoogleOAuthConfig = async ({
  appPath,
}: LoadGoogleOAuthConfigOptions): Promise<GoogleOAuthConfig> => {
  const clientId =
    process.env.SURVEY_SYNTH_GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_OAUTH_ID?.trim();
  const clientSecret =
    process.env.SURVEY_SYNTH_GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_SECRET?.trim();

  if (clientId) {
    return {
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }

  const configuredPath = process.env.SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG?.trim();
  const candidates = [
    ...(configuredPath ? [configuredPath] : []),
    join(appPath, "google_oauth.local.json"),
    join(process.cwd(), "google_oauth.local.json"),
  ];

  for (const path of [...new Set(candidates)]) {
    try {
      return parseClientFile(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof SyntaxError) {
        throw backendFailure("VALIDATION_FAILED", "Google OAuth configuration is invalid");
      }
      throw error;
    }
  }

  throw backendFailure(
    "VALIDATION_FAILED",
    "Google OAuth client is not configured. Add google_oauth.local.json or set SURVEY_SYNTH_GOOGLE_CLIENT_ID.",
  );
};
