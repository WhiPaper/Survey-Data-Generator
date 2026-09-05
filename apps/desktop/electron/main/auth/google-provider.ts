import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

import { backendFailure, BackendFailure } from "../errors";
import type { GoogleOAuthConfig } from "./config";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
] as const;

export type GoogleInteractiveFlow = "login" | "add_account";

export type GoogleIdentity = {
  subject: string;
  email: string;
  displayName?: string;
};

export type GoogleGrant = {
  identity: GoogleIdentity;
  accessToken: string;
  expiresAtMs: number;
  refreshToken?: string;
};

export type GoogleRefreshedAccess = {
  accessToken: string;
  expiresAtMs: number;
};

export interface GoogleProvider {
  authorize(flow: GoogleInteractiveFlow): Promise<GoogleGrant>;
  refresh(refreshToken: string): Promise<GoogleRefreshedAccess>;
  revoke(refreshToken: string): Promise<void>;
}

export type CreateGoogleProviderOptions = {
  getConfig(): Promise<GoogleOAuthConfig>;
  openExternal(url: string): Promise<void>;
  timeoutMs?: number;
  now?: () => number;
};

const googleError = (error: unknown, fallback: string): BackendFailure => {
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  const body = response?.data;
  const providerCode =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: unknown }).error
      : undefined;

  if (providerCode === "invalid_grant" || response?.status === 401) {
    return backendFailure("REAUTH_REQUIRED", "Google authorization expired. Sign in again.");
  }
  if (response?.status === 403) {
    return backendFailure("PERMISSION_DENIED", "Google permission was denied");
  }
  if (response?.status === 429) {
    return backendFailure("RATE_LIMITED", "Google rate limit was reached");
  }
  return backendFailure("GOOGLE_API_ERROR", fallback);
};

const createOAuthClient = (config: GoogleOAuthConfig, redirectUri?: string): OAuth2Client =>
  new OAuth2Client({
    clientId: config.clientId,
    ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  });

const listenLoopback = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw backendFailure("INTERNAL", "Google login callback address was unavailable");
  }
  return address.port;
};

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const respond = (response: ServerResponse, status: number, text: string): void => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(text);
};

const callbackCode = (
  request: IncomingMessage,
  response: ServerResponse,
  expectedState: string,
): string | Error | null => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/oauth2/callback") {
    respond(response, 404, "Not found");
    return null;
  }
  if (url.searchParams.get("state") !== expectedState) {
    respond(response, 400, "Authorization failed");
    return backendFailure("VALIDATION_FAILED", "Google authorization state was invalid");
  }
  if (url.searchParams.has("error")) {
    respond(response, 400, "Authorization cancelled");
    return backendFailure("VALIDATION_FAILED", "Google authorization was cancelled");
  }
  const code = url.searchParams.get("code");
  if (!code) {
    respond(response, 400, "Authorization failed");
    return backendFailure("VALIDATION_FAILED", "Google authorization code was missing");
  }
  respond(response, 200, "Survey Synth authorization completed. You can close this window.");
  return code;
};

const waitForOAuthCode = (
  server: Server,
  state: string,
  timeoutMs: number,
): { promise: Promise<string>; stop: () => void } => {
  let stop = (): void => undefined;
  const promise = new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = (): void => {
      clearTimeout(timer);
      server.off("request", onRequest);
      server.off("error", onError);
    };
    const finish = (result: string | Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
      if (settled) {
        respond(response, 409, "Authorization callback already handled");
        return;
      }
      const result = callbackCode(request, response, state);
      if (result !== null) finish(result);
    };
    const onError = (): void =>
      finish(backendFailure("INTERNAL", "Google login callback failed"));

    server.on("request", onRequest);
    server.on("error", onError);
    timer = setTimeout(
      () => finish(backendFailure("VALIDATION_FAILED", "Google login timed out")),
      timeoutMs,
    );
    stop = cleanup;
  });
  return { promise, stop };
};

export const createGoogleProvider = ({
  getConfig,
  openExternal,
  timeoutMs = 5 * 60_000,
  now = Date.now,
}: CreateGoogleProviderOptions): GoogleProvider => ({
  authorize: async (flow) => {
    const config = await getConfig();
    const server = createServer();
    const state = randomBytes(32).toString("base64url");
    let stopWaiting = (): void => undefined;

    try {
      const port = await listenLoopback(server);
      const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
      const client = createOAuthClient(config, redirectUri);
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      if (!codeChallenge) throw backendFailure("INTERNAL", "Google PKCE challenge was unavailable");

      const authorizationUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: [...GOOGLE_SCOPES],
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        include_granted_scopes: true,
        prompt: flow === "add_account" ? "select_account consent" : "consent",
      });

      const callback = waitForOAuthCode(server, state, timeoutMs);
      stopWaiting = callback.stop;
      await openExternal(authorizationUrl);
      const code = await callback.promise;

      let tokens;
      try {
        ({ tokens } = await client.getToken({ code, codeVerifier }));
      } catch (error: unknown) {
        throw googleError(error, "Google login failed");
      }
      if (!tokens.access_token || !tokens.id_token) {
        throw backendFailure("GOOGLE_API_ERROR", "Google login returned incomplete credentials");
      }

      let payload: Record<string, unknown>;
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: config.clientId,
        });
        payload = (ticket.getPayload() ?? {}) as unknown as Record<string, unknown>;
      } catch (error: unknown) {
        throw googleError(error, "Google identity could not be verified");
      }

      if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
        throw backendFailure("GOOGLE_API_ERROR", "Google identity was incomplete");
      }

      return {
        identity: {
          subject: payload.sub,
          email: payload.email,
          ...(typeof payload.name === "string" && payload.name.length > 0
            ? { displayName: payload.name }
            : {}),
        },
        accessToken: tokens.access_token,
        expiresAtMs: tokens.expiry_date ?? now() + 60 * 60_000,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      };
    } finally {
      stopWaiting();
      await closeServer(server);
    }
  },

  refresh: async (refreshToken) => {
    const config = await getConfig();
    const client = createOAuthClient(config);
    client.setCredentials({ refresh_token: refreshToken });
    try {
      const result = await client.getAccessToken();
      if (!result.token) throw backendFailure("REAUTH_REQUIRED", "Google authorization expired. Sign in again.");
      return {
        accessToken: result.token,
        expiresAtMs: client.credentials.expiry_date ?? now() + 60 * 60_000,
      };
    } catch (error: unknown) {
      if (error instanceof BackendFailure) throw error;
      throw googleError(error, "Google access token could not be refreshed");
    }
  },

  revoke: async (refreshToken) => {
    const config = await getConfig();
    const client = createOAuthClient(config);
    try {
      await client.revokeToken(refreshToken);
    } catch (error: unknown) {
      throw googleError(error, "Google access could not be revoked");
    }
  },
});
