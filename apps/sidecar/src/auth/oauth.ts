import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { sidecarError } from "../errors.js";
import type { HostCapabilityClient } from "../host.js";
import type { GoogleOAuthConfig, GoogleOAuthConfigProvider } from "./config.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
] as const;

export type GoogleInteractiveFlow = "login" | "add_account";

export interface GoogleAuthorizationCode {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export interface GoogleOAuthFlow {
  authorize(flow: GoogleInteractiveFlow): Promise<GoogleAuthorizationCode>;
  close?(): void | Promise<void>;
}

export interface BrowserGoogleOAuthFlowOptions {
  readonly host: HostCapabilityClient;
  readonly getConfig: GoogleOAuthConfigProvider;
  readonly timeoutMs?: number;
}

export const createPkceVerifier = (): string => randomBytes(32).toString("base64url");

export const createOAuthState = (): string => randomBytes(32).toString("base64url");

export const createPkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export const buildAuthorizationUrl = (
  config: GoogleOAuthConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  flow: GoogleInteractiveFlow,
): string => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: flow === "login" ? "consent" : "select_account consent",
  });
  return `${config.authUri}?${params.toString()}`;
};

export class BrowserGoogleOAuthFlow implements GoogleOAuthFlow {
  private activeFlow: Promise<GoogleAuthorizationCode> | null = null;
  private cancelActive: (() => void) | null = null;

  public constructor(private readonly options: BrowserGoogleOAuthFlowOptions) {}

  public authorize(flow: GoogleInteractiveFlow): Promise<GoogleAuthorizationCode> {
    if (this.activeFlow !== null) {
      return Promise.reject(
        sidecarError("VALIDATION_FAILED", "Another Google login is already in progress", true),
      );
    }
    const controller = new AbortController();
    const operation = this.run(flow, controller.signal);
    this.activeFlow = operation;
    this.cancelActive = () => controller.abort();
    void operation.then(
      () => this.clearActive(operation),
      () => this.clearActive(operation),
    );
    return operation;
  }

  private clearActive(operation: Promise<GoogleAuthorizationCode>): void {
    if (this.activeFlow !== operation) return;
    this.activeFlow = null;
    this.cancelActive = null;
  }

  public async close(): Promise<void> {
    const operation = this.activeFlow;
    this.cancelActive?.();
    await operation?.catch(() => undefined);
  }

  private async run(
    flow: GoogleInteractiveFlow,
    signal: AbortSignal,
  ): Promise<GoogleAuthorizationCode> {
    const config = await this.options.getConfig();
    const state = createOAuthState();
    const codeVerifier = createPkceVerifier();
    const server = createServer();
    const timeoutMs = this.options.timeoutMs ?? 5 * 60 * 1000;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let redirectUri: string | undefined;
    let finishCallback!: (result: GoogleAuthorizationCode | Error) => void;

    const callbackResult = new Promise<GoogleAuthorizationCode>((resolve, reject) => {
      finishCallback = (result: GoogleAuthorizationCode | Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
    });

    const cancelError = (): Error =>
      sidecarError("BACKEND_UNAVAILABLE", "Google login was cancelled", true);
    const onAbort = (): void => {
      finishCallback(cancelError());
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    let callbackHandled = false;
    const onServerError = (): void => {
      finishCallback(sidecarError("INTERNAL", "Google login callback could not start", true));
    };
    const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
      try {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        if (requestUrl.pathname !== "/oauth2/callback") {
          response.writeHead(404);
          response.end();
          return;
        }
        if (callbackHandled) {
          response.writeHead(409);
          response.end("Authorization callback already handled");
          return;
        }
        callbackHandled = true;
        const returnedState = requestUrl.searchParams.get("state");
        if (returnedState !== state) {
          response.writeHead(400);
          response.end("Authorization failed");
          finishCallback(
            sidecarError("VALIDATION_FAILED", "Google authorization state was invalid", true),
          );
          return;
        }
        const providerError = requestUrl.searchParams.get("error");
        if (providerError !== null) {
          response.writeHead(400);
          response.end("Authorization cancelled");
          finishCallback(
            sidecarError("VALIDATION_FAILED", "Google authorization was cancelled", true),
          );
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (code === null || code.length === 0) {
          response.writeHead(400);
          response.end("Authorization failed");
          finishCallback(
            sidecarError("VALIDATION_FAILED", "Google authorization code was missing", true),
          );
          return;
        }
        if (redirectUri === undefined) {
          response.writeHead(500);
          response.end("Authorization failed");
          finishCallback(
            sidecarError("INTERNAL", "Google login callback address was unavailable", true),
          );
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end("You can close this window.");
        finishCallback({ code, redirectUri, codeVerifier });
      } catch {
        response.writeHead(400);
        response.end("Authorization failed");
        finishCallback(
          sidecarError("VALIDATION_FAILED", "Google authorization callback was invalid", true),
        );
      }
    };
    server.on("request", onRequest);

    try {
      if (signal.aborted) return await callbackResult;
      await listenLoopback(server);
      if (signal.aborted) return await callbackResult;
      server.on("error", onServerError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        finishCallback(
          sidecarError("INTERNAL", "Google login callback address was unavailable", true),
        );
      } else {
        redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
        timer = setTimeout(
          () => finishCallback(sidecarError("VALIDATION_FAILED", "Google login timed out", true)),
          timeoutMs,
        );
        const authorizationUrl = buildAuthorizationUrl(
          config,
          redirectUri,
          state,
          createPkceChallenge(codeVerifier),
          flow,
        );
        void this.options.host.call("host.open_external", { url: authorizationUrl }).catch(() => {
          finishCallback(sidecarError("INTERNAL", "Could not open the system browser", true));
        });
      }
      return await callbackResult;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      server.off("error", onServerError);
      server.off("request", onRequest);
      await closeServer(server);
    }
  }
}

const listenLoopback = async (server: Server): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      server.off("error", onError);
      reject(sidecarError("INTERNAL", "Google login callback could not start", true));
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};
