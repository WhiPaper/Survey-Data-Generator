import { randomUUID } from "node:crypto";

import type { GoogleAccount, GoogleAccountId } from "@survey-synth/domain";
import {
  AuthActionResultSchema,
  type GoogleAccountView,
  type SessionView,
} from "@survey-synth/contracts";

import { sidecarError, SidecarError } from "../errors.js";
import type { SafeLogger } from "../rpc/logger.js";
import type { GoogleAccountRepository } from "./account-store.js";
import {
  GoogleProviderError,
  type GoogleIdentity,
  type GoogleTokenClient,
  type GoogleTokenSet,
  mapGoogleProviderError,
} from "./google.js";
import type { GoogleInteractiveFlow, GoogleOAuthFlow } from "./oauth.js";
import type { GoogleTokenStore } from "../host.js";
import { InMemoryGoogleAccessTokenProvider } from "./tokens.js";

const REQUIRED_IDENTITY_SCOPE_ALIASES = [
  ["openid"],
  ["email", "https://www.googleapis.com/auth/userinfo.email"],
  ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
] as const;

export interface GoogleAuthService {
  getSession(): Promise<SessionView | null>;
  login(): Promise<SessionView>;
  addAccount(): Promise<SessionView>;
  switchAccount(id: GoogleAccountId): Promise<SessionView>;
  logout(): Promise<void>;
  revokeAccess(id: GoogleAccountId): Promise<void>;
  getAccounts(): Promise<GoogleAccountView[]>;
}

export interface GoogleAuthServiceOptions {
  readonly accounts: GoogleAccountRepository;
  readonly tokenStore: GoogleTokenStore;
  readonly google: GoogleTokenClient;
  readonly oauth: GoogleOAuthFlow;
  readonly accessTokens: InMemoryGoogleAccessTokenProvider;
  readonly logger: SafeLogger;
  readonly now?: () => number;
  readonly createAccountId?: () => GoogleAccountId;
}

export class GoogleAuthServiceImpl implements GoogleAuthService {
  private readonly now: () => number;
  private readonly createAccountId: () => GoogleAccountId;

  public constructor(private readonly options: GoogleAuthServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createAccountId = options.createAccountId ?? (() => randomUUID() as GoogleAccountId);
  }

  public async getSession(): Promise<SessionView | null> {
    const accountId = await this.options.accounts.getLastAccountId();
    if (accountId === null) return null;
    const account = await this.options.accounts.findById(accountId);
    if (account === null) {
      await this.clearLastAccountId(accountId);
      return null;
    }
    try {
      await this.options.accessTokens.getAccessToken(accountId);
    } catch (error: unknown) {
      const backendError = error instanceof SidecarError ? error.backendError : undefined;
      this.options.logger.error("session_restore_failed", {
        errorCode: backendError?.code ?? "INTERNAL",
      });
      if (error instanceof SidecarError && error.backendError.code === "REAUTH_REQUIRED") {
        await this.clearLastAccountId(accountId);
      }
      if (error instanceof SidecarError) throw error;
      throw sidecarError("INTERNAL", "Google session could not be restored", true);
    }
    return sessionView(account);
  }

  public login(): Promise<SessionView> {
    return this.authenticate("login");
  }

  public addAccount(): Promise<SessionView> {
    return this.authenticate("add_account");
  }

  public async switchAccount(id: GoogleAccountId): Promise<SessionView> {
    const account = await this.options.accounts.findById(id);
    if (account === null) throw sidecarError("NOT_FOUND", "Google account was not found", true);
    await this.options.accessTokens.getAccessToken(id);
    const updated = { ...account, lastUsedAt: this.timestamp() };
    await this.options.accounts.upsert(updated);
    await this.options.accounts.setLastAccountId(id);
    return sessionView(updated);
  }

  public async logout(): Promise<void> {
    const activeId = await this.options.accounts.getLastAccountId();
    if (activeId === null) return;
    const account = await this.options.accounts.findById(activeId);
    await this.options.accessTokens.clearAccessToken(activeId);
    if (account !== null) {
      try {
        await this.options.tokenStore.deleteRefreshToken(account.subject);
      } catch {
        throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
      }
    }
    await this.options.accounts.setLastAccountId(null);
  }

  public async revokeAccess(id: GoogleAccountId): Promise<void> {
    const account = await this.options.accounts.findById(id);
    if (account === null) throw sidecarError("NOT_FOUND", "Google account was not found", true);
    await this.options.accessTokens.clearAccessToken(id);

    let refreshToken: string | null;
    try {
      refreshToken = await this.options.tokenStore.getRefreshToken(account.subject);
    } catch {
      throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
    }

    if (refreshToken !== null) {
      try {
        await this.options.google.revokeToken(refreshToken);
      } catch (error: unknown) {
        throw mapGoogleProviderError(error, "Google access revocation failed");
      }
    }

    try {
      await this.options.tokenStore.deleteRefreshToken(account.subject);
    } catch {
      throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
    }
    if ((await this.options.accounts.getLastAccountId()) === id) {
      await this.options.accounts.setLastAccountId(null);
    }
  }

  public async getAccounts(): Promise<GoogleAccountView[]> {
    const accounts = await this.options.accounts.list();
    return accounts.map(accountView);
  }

  private async authenticate(flow: GoogleInteractiveFlow): Promise<SessionView> {
    const authorization = await this.options.oauth.authorize(flow);
    let tokenSet: GoogleTokenSet;
    let identity: GoogleIdentity;
    try {
      tokenSet = await this.options.google.exchangeCode(authorization);
      identity = await this.options.google.resolveIdentity(tokenSet.accessToken);
    } catch (error: unknown) {
      if (error instanceof SidecarError) throw error;
      if (error instanceof GoogleProviderError) {
        throw mapGoogleProviderError(error, "Google login failed");
      }
      throw sidecarError("INTERNAL", "Google login failed", true);
    }

    const identityScopes = new Set(tokenSet.grantedScopes);
    if (
      REQUIRED_IDENTITY_SCOPE_ALIASES.some(
        (aliases) => !aliases.some((scope) => identityScopes.has(scope)),
      )
    ) {
      throw sidecarError("PERMISSION_DENIED", "Google identity scopes were not granted", true);
    }

    const existing = await this.options.accounts.findBySubject(identity.subject);
    let previousRefreshToken: string | null = null;
    if (existing !== null) {
      try {
        previousRefreshToken = await this.options.tokenStore.getRefreshToken(existing.subject);
      } catch {
        throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
      }
    }
    const refreshToken = tokenSet.refreshToken ?? previousRefreshToken;
    if (refreshToken === null) {
      throw sidecarError("REAUTH_REQUIRED", "Google did not grant offline access", true);
    }

    const account: GoogleAccount = {
      id: existing?.id ?? this.createAccountId(),
      subject: identity.subject,
      email: identity.email,
      ...(identity.displayName === undefined && existing?.displayName === undefined
        ? {}
        : { displayName: identity.displayName ?? existing?.displayName }),
      createdAt: existing?.createdAt ?? this.timestamp(),
      lastUsedAt: this.timestamp(),
    };
    const newRefreshToken = tokenSet.refreshToken;
    if (newRefreshToken !== undefined) {
      try {
        await this.options.tokenStore.setRefreshToken(account.subject, newRefreshToken);
      } catch {
        throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
      }
    }

    try {
      await this.options.accounts.upsert(account);
      await this.options.accounts.setLastAccountId(account.id);
    } catch (error: unknown) {
      await this.rollbackAccount(existing, account, previousRefreshToken, newRefreshToken);
      if (error instanceof SidecarError) throw error;
      throw sidecarError("INTERNAL", "Local account state could not be saved", true);
    }

    this.options.accessTokens.setAccessToken(account.id, tokenSet);
    this.options.logger.info("google_auth_success", {
      scopesGranted: tokenSet.grantedScopes.length,
    });
    return sessionView(account);
  }

  private async rollbackAccount(
    previous: GoogleAccount | null,
    current: GoogleAccount,
    previousRefreshToken: string | null,
    newRefreshToken: string | undefined,
  ): Promise<void> {
    try {
      if (previous === null) await this.options.accounts.remove(current.id);
      else await this.options.accounts.upsert(previous);
      if (newRefreshToken !== undefined) {
        if (previousRefreshToken === null) {
          await this.options.tokenStore.deleteRefreshToken(current.subject);
        } else {
          await this.options.tokenStore.setRefreshToken(current.subject, previousRefreshToken);
        }
      }
    } catch {
      this.options.logger.error("account_rollback_failed", { errorCode: "INTERNAL" });
    }
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private async clearLastAccountId(id: GoogleAccountId): Promise<void> {
    if ((await this.options.accounts.getLastAccountId()) !== id) return;
    try {
      await this.options.accounts.setLastAccountId(null);
    } catch {
      this.options.logger.error("session_state_cleanup_failed", { errorCode: "INTERNAL" });
    }
  }
}

const accountView = (account: GoogleAccount): GoogleAccountView => ({
  id: account.id,
  email: account.email,
  ...(account.displayName === undefined ? {} : { displayName: account.displayName }),
});

const sessionView = (account: GoogleAccount): SessionView => ({
  account: accountView(account),
});

export const authActionResult = (): { ok: true } => AuthActionResultSchema.parse({ ok: true });
