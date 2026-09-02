import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadGoogleOAuthConfig } from "../src/auth/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google OAuth configuration", () => {
  it("accepts known Google installed-app endpoint variants", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-oauth-"));
    const path = join(directory, "client.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          installed: {
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            client_id: "client-id",
            token_uri: "https://www.googleapis.com/oauth2/v4/token",
          },
        }),
      );
      vi.stubEnv("SURVEY_SYNTH_GOOGLE_CLIENT_ID", "");
      vi.stubEnv("SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG", path);

      await expect(loadGoogleOAuthConfig()).resolves.toMatchObject({ clientId: "client-id" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects non-Google OAuth endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-oauth-"));
    const path = join(directory, "client.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          installed: {
            auth_uri: "https://evil.example/authorize",
            client_id: "client-id",
            token_uri: "https://oauth2.googleapis.com/token",
          },
        }),
      );
      vi.stubEnv("SURVEY_SYNTH_GOOGLE_CLIENT_ID", "");
      vi.stubEnv("SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG", path);

      await expect(loadGoogleOAuthConfig()).rejects.toMatchObject({
        backendError: { code: "VALIDATION_FAILED" },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
