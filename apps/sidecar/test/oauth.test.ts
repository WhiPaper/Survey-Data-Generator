import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createHostCapabilityClient } from "../src/host.js";
import {
  BrowserGoogleOAuthFlow,
  buildAuthorizationUrl,
  createPkceChallenge,
  GOOGLE_SCOPES,
} from "../src/auth/oauth.js";
import type { GoogleOAuthConfig } from "../src/auth/config.js";
import { VERSIONS } from "@survey-synth/contracts";

const config: GoogleOAuthConfig = {
  authUri: "https://accounts.google.com/o/oauth2/v2/auth",
  clientId: "client-id",
  revokeUri: "https://oauth2.googleapis.com/revoke",
  tokenUri: "https://oauth2.googleapis.com/token",
  userInfoUri: "https://openidconnect.googleapis.com/v1/userinfo",
};

const callbackFromHostRequest = (
  output: PassThrough,
  stateOverride?: string,
): {
  authorizationState: Promise<string>;
  callbackUri: Promise<string>;
  flow: BrowserGoogleOAuthFlow;
} => {
  const host = createHostCapabilityClient(output);
  let resolveAuthorizationState!: (state: string) => void;
  const authorizationState = new Promise<string>((resolve) => {
    resolveAuthorizationState = resolve;
  });
  let resolveCallbackUri!: (uri: string) => void;
  const callbackUri = new Promise<string>((resolve) => {
    resolveCallbackUri = resolve;
  });
  output.on("data", (chunk: Buffer) => {
    const message = JSON.parse(chunk.toString()) as {
      type?: string;
      id?: string;
      params?: { url?: string };
    };
    if (
      message.type !== "host_request" ||
      message.id === undefined ||
      message.params?.url === undefined
    ) {
      return;
    }
    const authorizationUrl = new URL(message.params.url);
    const callback = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "");
    resolveAuthorizationState(authorizationUrl.searchParams.get("state") ?? "");
    resolveCallbackUri(callback.toString());
    host.handleMessage({
      v: VERSIONS.protocolVersion,
      type: "host_response",
      id: message.id,
      ok: true,
      result: { ok: true },
    });
    if (stateOverride !== undefined) return;
    void fetch(
      `${callback.toString()}?state=${authorizationUrl.searchParams.get("state")}&code=code`,
    );
  });
  const flow = new BrowserGoogleOAuthFlow({
    getConfig: async () => config,
    host,
    timeoutMs: 1_000,
  });
  return { authorizationState, callbackUri, flow };
};

describe("Google installed-app OAuth", () => {
  it("uses PKCE S256, random state, loopback callback, and add-account prompt", async () => {
    const output = new PassThrough();
    const { flow } = callbackFromHostRequest(output);
    const authorization = await flow.authorize("add_account");

    expect(authorization.code).toBe("code");
    expect(new URL(authorization.redirectUri).hostname).toBe("127.0.0.1");
    expect(authorization.codeVerifier).toHaveLength(43);
    output.end();
  });

  it("generates the RFC PKCE challenge and required authorization parameters", () => {
    expect(createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    const url = new URL(
      buildAuthorizationUrl(
        config,
        "http://127.0.0.1:4321/oauth2/callback",
        "state",
        "challenge",
        "add_account",
      ),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4321/oauth2/callback");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
  });

  it("rejects a state mismatch and closes the callback flow", async () => {
    const output = new PassThrough();
    const { callbackUri, flow } = callbackFromHostRequest(output, "wrong-state");
    const result = flow.authorize("login");
    const callback = await callbackUri;
    await expect(fetch(`${callback}?state=wrong-state&code=code`)).resolves.toBeDefined();
    await expect(result).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    output.end();
  });

  it("handles the first callback once and closes the listener", async () => {
    const output = new PassThrough();
    const { authorizationState, callbackUri, flow } = callbackFromHostRequest(output, "manual");
    const result = flow.authorize("login");
    const callback = await callbackUri;
    const state = await authorizationState;
    await expect(fetch(`${callback}?state=${state}&code=code`)).resolves.toBeDefined();
    await expect(result).resolves.toMatchObject({ code: "code" });
    await expect(fetch(`${callback}?state=${state}&code=second`)).rejects.toThrow();
    output.end();
  });

  it("times out abandoned login and rejects a second concurrent flow", async () => {
    const output = new PassThrough();
    const host = createHostCapabilityClient(output);
    const flow = new BrowserGoogleOAuthFlow({
      getConfig: async () => config,
      host,
      timeoutMs: 25,
    });
    const first = flow.authorize("login");
    await expect(flow.authorize("add_account")).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    await expect(first).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    output.end();
  });

  it("cancels an active flow and closes its loopback listener", async () => {
    const output = new PassThrough();
    const { callbackUri, flow } = callbackFromHostRequest(output, "manual");
    const result = flow.authorize("login");
    const callback = await callbackUri;

    await flow.close();
    await expect(result).rejects.toMatchObject({
      backendError: { code: "BACKEND_UNAVAILABLE" },
    });
    await expect(fetch(`${callback}?state=unused&code=code`)).rejects.toThrow();
    output.end();
  });
});
