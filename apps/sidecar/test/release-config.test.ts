import { describe, expect, it, vi } from "vitest";

import { loadGoogleOAuthConfig } from "../src/auth/config.js";

describe("release OAuth configuration", () => {
  it("never reads a working-directory OAuth file in packaged runtime", async () => {
    vi.stubEnv("SURVEY_SYNTH_PACKAGED", "1");
    vi.stubEnv("SURVEY_SYNTH_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG", "");
    await expect(loadGoogleOAuthConfig()).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    vi.unstubAllEnvs();
  });
});
