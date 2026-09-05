import type { GoogleAccountId } from "@survey-synth/domain";
import type { GoogleAccountView, SessionView } from "@survey-synth/contracts";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import {
  getActiveGoogleAccountId,
  getGoogleAccount,
  listGoogleAccounts,
  removeGoogleAccount,
  setActiveGoogleAccountId,
  upsertGoogleAccount,
  type GoogleAccountRecord,
} from "../persistence/store";
import type { RefreshTokenStore } from "./credentials";
import type { GoogleInteractiveFlow, GoogleProvider } from "./google-provider";

const ACCESS_TOKEN_SAFETY_MARGIN_MS = 60_000;

type CachedAccessToken = {
  value: string;
  expiresAtMs: number;
};

export interface GoogleAuthService {
  getSession(): Promise<SessionView | null>;
  login(): Promise<SessionView>;
  addAccount(): Promise<SessionView>;
  switchAccount(id: GoogleAccountId): Promise<SessionView>;
  logout(): Promise<void>;
  revokeAccess(id: GoogleAccountId): Promise<void>;
  deleteAccountData(id: GoogleAccountId): Promise<void>;
  getAccounts(): Promise<GoogleAccountView[]>;
  getAccessToken(id: GoogleAccountId): Promise<string>;
  refreshAccessToken(id: GoogleAccountId): Promise<string>;
}

export type CreateGoogleAuthServiceOptions = {
  db: SurveyDatabase;
  refreshTokens: RefreshTokenStore;
  google: GoogleProvider;
  now?: () => number;
};

const accountView = (account: GoogleAccountRecord): GoogleAccountView => ({
  id: account.id as GoogleAccountId,
  email: account.email,
  ...(account.displayName ? { displayName: account.displayName } : {}),
});

const sessionView = (account: GoogleAccountRecord): SessionView => ({ account: accountView(account) });

export const createGoogleAuthService = ({
  db,
  refreshTokens,
  google,
  now = Date.now,
}: CreateGoogleAuthServiceOptions): GoogleAuthService => {
  const accessTokens = new Map<string, CachedAccessToken>();

  const authenticate = async (flow: GoogleInteractiveFlow): Promise<SessionView> => {
    const grant = await google.authorize(flow);
    const accountId = grant.identity.subject;
    const previousRefreshToken = await refreshTokens.get(accountId);
    const refreshToken = grant.refreshToken ?? previousRefreshToken;
    if (!refreshToken) {
      throw backendFailure("REAUTH_REQUIRED", "Google did not grant offline access. Sign in again.");
    }

    if (grant.refreshToken) await refreshTokens.set(accountId, grant.refreshToken);
    const account = upsertGoogleAccount(db, {
      id: accountId,
      email: grant.identity.email,
      displayName: grant.identity.displayName,
      nowMs: now(),
    });
    setActiveGoogleAccountId(db, accountId, now());
    accessTokens.set(accountId, {
      value: grant.accessToken,
      expiresAtMs: grant.expiresAtMs,
    });
    return sessionView(account);
  };

  const refreshAccessToken = async (id: GoogleAccountId): Promise<string> => {
    if (!getGoogleAccount(db, id)) {
      throw backendFailure("NOT_FOUND", "Google account was not found");
    }
    const refreshToken = await refreshTokens.get(id);
    if (!refreshToken) {
      throw backendFailure("REAUTH_REQUIRED", "Google authorization expired. Sign in again.");
    }
    const refreshed = await google.refresh(refreshToken);
    accessTokens.set(id, {
      value: refreshed.accessToken,
      expiresAtMs: refreshed.expiresAtMs,
    });
    return refreshed.accessToken;
  };

  return {
    getSession: async () => {
      const accountId = getActiveGoogleAccountId(db);
      if (!accountId) return null;
      const account = getGoogleAccount(db, accountId);
      if (!account || (await refreshTokens.get(accountId)) === null) {
        setActiveGoogleAccountId(db, null);
        accessTokens.delete(accountId);
        return null;
      }
      return sessionView(account);
    },

    login: () => authenticate("login"),
    addAccount: () => authenticate("add_account"),

    switchAccount: async (id) => {
      const account = getGoogleAccount(db, id);
      if (!account) throw backendFailure("NOT_FOUND", "Google account was not found");
      if ((await refreshTokens.get(id)) === null) {
        throw backendFailure("REAUTH_REQUIRED", "This Google account needs to sign in again");
      }
      const updated = upsertGoogleAccount(db, {
        id: account.id,
        email: account.email,
        displayName: account.displayName ?? undefined,
        nowMs: now(),
      });
      setActiveGoogleAccountId(db, id, now());
      return sessionView(updated);
    },

    logout: async () => {
      const accountId = getActiveGoogleAccountId(db);
      if (!accountId) return;
      accessTokens.delete(accountId);
      await refreshTokens.delete(accountId);
      setActiveGoogleAccountId(db, null);
    },

    revokeAccess: async (id) => {
      const account = getGoogleAccount(db, id);
      if (!account) throw backendFailure("NOT_FOUND", "Google account was not found");
      const refreshToken = await refreshTokens.get(id);
      if (refreshToken) await google.revoke(refreshToken);
      await refreshTokens.delete(id);
      accessTokens.delete(id);
      if (getActiveGoogleAccountId(db) === id) setActiveGoogleAccountId(db, null);
    },

    deleteAccountData: async (id) => {
      await refreshTokens.delete(id);
      accessTokens.delete(id);
      if (getActiveGoogleAccountId(db) === id) setActiveGoogleAccountId(db, null);
      removeGoogleAccount(db, id);
    },

    getAccounts: async () => listGoogleAccounts(db).map(accountView),

    getAccessToken: async (id) => {
      const cached = accessTokens.get(id);
      if (cached && cached.expiresAtMs - ACCESS_TOKEN_SAFETY_MARGIN_MS > now()) {
        return cached.value;
      }
      return refreshAccessToken(id);
    },

    refreshAccessToken,
  };
};
