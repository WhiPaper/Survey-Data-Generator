import { describe, expect, it, vi } from "vitest";

import type { GoogleOAuthConfig } from "../src/auth/config.js";
import { GoogleHttpClient, GoogleProviderError } from "../src/auth/google.js";
import type { GoogleAuthorizationCode } from "../src/auth/oauth.js";

const config: GoogleOAuthConfig = {
  authUri: "https://accounts.google.com/o/oauth2/v2/auth",
  clientId: "client-id",
  clientSecret: "client-secret",
  revokeUri: "https://oauth2.googleapis.com/revoke",
  tokenUri: "https://oauth2.googleapis.com/token",
  userInfoUri: "https://openidconnect.googleapis.com/v1/userinfo",
};

const authorization: GoogleAuthorizationCode = {
  code: "authorization-code",
  codeVerifier: "pkce-verifier",
  redirectUri: "http://127.0.0.1:4321/oauth2/callback",
};

describe("Google HTTP token client", () => {
  it("parses granted scopes and resolves userinfo identity", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            id_token: "id-token",
            refresh_token: "refresh-token",
            scope: "openid email profile",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user@example.com",
            name: "User",
            picture: "https://lh3.googleusercontent.com/avatar",
            sub: "subject",
          }),
          { status: 200 },
        ),
      );
    const client = new GoogleHttpClient({ getConfig: async () => config, fetchImpl });

    const tokenSet = await client.exchangeCode(authorization);
    expect(tokenSet).toMatchObject({
      accessToken: "access-token",
      grantedScopes: ["openid", "email", "profile"],
      refreshToken: "refresh-token",
    });
    const identity = await client.resolveIdentity(tokenSet.accessToken);
    expect(identity).toEqual({
      displayName: "User",
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
      email: "user@example.com",
      subject: "subject",
    });
    const requestBody = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(requestBody).toContain("code_verifier=pkce-verifier");
    expect(requestBody).toContain("grant_type=authorization_code");
  });

  it("classifies terminal invalid_grant without exposing provider text", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "secret detail" }), {
        status: 400,
      }),
    );
    const client = new GoogleHttpClient({ getConfig: async () => config, fetchImpl });

    await expect(client.refreshAccessToken("refresh-token")).rejects.toEqual(
      new GoogleProviderError("invalid_grant", 400),
    );
    await expect(client.refreshAccessToken("refresh-token")).rejects.not.toThrow("secret detail");
  });

  it("classifies provider quota errors separately from permission errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "rateLimitExceeded" }), { status: 403 }),
      );
    const client = new GoogleHttpClient({ getConfig: async () => config, fetchImpl });

    await expect(client.refreshAccessToken("refresh-token")).rejects.toEqual(
      new GoogleProviderError("rate_limited", 403),
    );
  });
});
