import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GoogleAccount, GoogleAccountId } from "@survey-synth/domain";
import { describe, expect, it, vi } from "vitest";

import type { SafeLogger } from "../src/rpc/logger.js";
import {
  MemoryGoogleAccountRepository,
  FileGoogleAccountRepository,
} from "../src/auth/account-store.js";
import {
  GOOGLE_SCOPES,
  type GoogleAuthorizationCode,
  type GoogleOAuthFlow,
} from "../src/auth/oauth.js";
import {
  GoogleProviderError,
  type GoogleIdentity,
  type GoogleTokenClient,
  type GoogleTokenSet,
} from "../src/auth/google.js";
import { GoogleAuthServiceImpl } from "../src/auth/service.js";
import { InMemoryGoogleAccessTokenProvider } from "../src/auth/tokens.js";
import { RemoteGoogleTokenStore, type SecureSecretStore } from "../src/host.js";
import { callGoogleApi } from "../src/auth/api.js";

const accountId = (value: string): GoogleAccountId => value as GoogleAccountId;

const tokenSet = (
  accessToken: string,
  refreshToken: string | undefined,
  expiresInSeconds = 3600,
  grantedScopes: readonly string[] = GOOGLE_SCOPES,
): GoogleTokenSet => ({
  accessToken,
  expiresInSeconds,
  ...(refreshToken === undefined ? {} : { refreshToken }),
  grantedScopes,
});

const identity = (subject: string, email: string, displayName = "Test User"): GoogleIdentity => ({
  subject,
  email,
  displayName,
});

class FakeSecretStore implements SecureSecretStore {
  public readonly values = new Map<string, Uint8Array>();

  public async get(key: string): Promise<Uint8Array | null> {
    const value = this.values.get(key);
    return value === undefined ? null : Uint8Array.from(value);
  }

  public async set(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, Uint8Array.from(value));
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class FakeOAuthFlow implements GoogleOAuthFlow {
  public readonly flows: string[] = [];
  public next: GoogleAuthorizationCode = {
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "http://127.0.0.1:1234/oauth2/callback",
  };

  public authorize(flow: "login" | "add_account"): Promise<GoogleAuthorizationCode> {
    this.flows.push(flow);
    return Promise.resolve(this.next);
  }
}

class FakeGoogle implements GoogleTokenClient {
  public exchanges: GoogleTokenSet[] = [];
  public identities: GoogleIdentity[] = [];
  public refreshHandler: (refreshToken: string) => Promise<GoogleTokenSet> = async (refreshToken) =>
    tokenSet(`access-for-${refreshToken}`, refreshToken);
  public readonly revokedTokens: string[] = [];

  public async exchangeCode(_input: GoogleAuthorizationCode): Promise<GoogleTokenSet> {
    const next = this.exchanges.shift();
    if (next === undefined) throw new Error("missing fake token exchange");
    return next;
  }

  public async refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
    return this.refreshHandler(refreshToken);
  }

  public async resolveIdentity(_accessToken: string): Promise<GoogleIdentity> {
    const next = this.identities.shift();
    if (next === undefined) throw new Error("missing fake identity");
    return next;
  }

  public async revokeToken(token: string): Promise<void> {
    this.revokedTokens.push(token);
  }
}

const logger: SafeLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

const makeService = (overrides: { now?: () => number; filePath?: string } = {}) => {
  const accounts = overrides.filePath
    ? new FileGoogleAccountRepository(overrides.filePath)
    : new MemoryGoogleAccountRepository();
  const secrets = new FakeSecretStore();
  const tokenStore = new RemoteGoogleTokenStore(secrets);
  const google = new FakeGoogle();
  const oauth = new FakeOAuthFlow();
  let nextAccountId = 1;
  const accessTokens = new InMemoryGoogleAccessTokenProvider(
    accounts,
    tokenStore,
    google,
    overrides.now,
  );
  const service = new GoogleAuthServiceImpl({
    accounts,
    accessTokens,
    createAccountId: () => accountId(`account-${nextAccountId++}`),
    google,
    logger,
    now: overrides.now,
    oauth,
    tokenStore,
  });
  return { accounts, accessTokens, google, oauth, secrets, service, tokenStore };
};

describe("Google account identity and lifecycle", () => {
  it("uses subject, not email, as account identity", async () => {
    const first = makeService();
    first.google.exchanges.push(tokenSet("access-1", "refresh-1"));
    first.google.identities.push(identity("subject-1", "first@example.com"));
    const firstSession = await first.service.login();

    first.google.exchanges.push(tokenSet("access-2", "refresh-2"));
    first.google.identities.push(identity("subject-1", "updated@example.com", "Updated User"));
    const secondSession = await first.service.login();

    expect(secondSession.account.id).toBe(firstSession.account.id);
    expect(await first.accounts.list()).toHaveLength(1);
    expect((await first.accounts.list())[0]).toMatchObject({
      email: "updated@example.com",
      subject: "subject-1",
    });
    expect(
      new TextDecoder().decode(first.secrets.values.get("google:subject-1:refresh_token")),
    ).toBe("refresh-2");

    first.google.exchanges.push(tokenSet("access-3", "refresh-3"));
    first.google.identities.push(identity("subject-2", "updated@example.com"));
    await first.service.addAccount();
    expect(await first.accounts.list()).toHaveLength(2);
  });

  it("accepts Google's canonical OIDC scope aliases", async () => {
    const setup = makeService();
    setup.google.exchanges.push(
      tokenSet("access-1", "refresh-1", 3600, [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ]),
    );
    setup.google.identities.push(identity("subject-1", "user@example.com"));

    await expect(setup.service.login()).resolves.toMatchObject({
      account: { email: "user@example.com" },
    });
  });

  it("retains an existing refresh token when a later exchange omits one", async () => {
    const setup = makeService();
    setup.google.exchanges.push(tokenSet("access-1", "refresh-1"));
    setup.google.identities.push(identity("subject-1", "user@example.com"));
    await setup.service.login();

    setup.google.exchanges.push(tokenSet("access-2", undefined));
    setup.google.identities.push(identity("subject-1", "updated@example.com"));
    await setup.service.login();

    expect(setup.secrets.values.get("google:subject-1:refresh_token")).toEqual(
      new TextEncoder().encode("refresh-1"),
    );
  });

  it("persists metadata without either token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-auth-"));
    const path = join(directory, "google-accounts.json");
    try {
      const current = makeService({ filePath: path });
      current.google.exchanges.push(tokenSet("access-1", "refresh-secret"));
      current.google.identities.push(identity("subject-1", "user@example.com"));
      await current.service.login();

      const persisted = await readFile(path, "utf8");
      expect(persisted).toContain("subject-1");
      expect(persisted).not.toContain("refresh-secret");
      expect(persisted).not.toContain("access-1");
      expect(JSON.parse(persisted) as unknown).toMatchObject({ version: 1 });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("restores a valid last account after service restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-auth-"));
    const path = join(directory, "google-accounts.json");
    try {
      const first = makeService({ filePath: path });
      first.google.exchanges.push(tokenSet("access-1", "refresh-1"));
      first.google.identities.push(identity("subject-1", "user@example.com"));
      const expected = await first.service.login();

      const second = makeService({ filePath: path });
      second.secrets.values.set(
        "google:subject-1:refresh_token",
        new TextEncoder().encode("refresh-1"),
      );
      const session = await second.service.getSession();

      expect(session).toEqual(expected);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports reauthentication while preserving account metadata when token is missing or invalid", async () => {
    const stale = makeService();
    await stale.accounts.setLastAccountId(accountId("missing-account"));
    await expect(stale.service.getSession()).resolves.toBeNull();
    expect(await stale.accounts.getLastAccountId()).toBeNull();

    const missing = makeService();
    await missing.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await missing.accounts.setLastAccountId(accountId("account-1"));
    await expect(missing.service.getSession()).rejects.toMatchObject({
      backendError: { code: "REAUTH_REQUIRED" },
    });
    expect(await missing.accounts.findById(accountId("account-1"))).not.toBeNull();
    expect(await missing.accounts.getLastAccountId()).toBeNull();

    const invalid = makeService();
    await invalid.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await invalid.accounts.setLastAccountId(accountId("account-1"));
    invalid.secrets.values.set(
      "google:subject-1:refresh_token",
      new TextEncoder().encode("revoked"),
    );
    invalid.google.refreshHandler = async () => {
      throw new GoogleProviderError("invalid_grant");
    };
    await expect(invalid.service.getSession()).rejects.toMatchObject({
      backendError: { code: "REAUTH_REQUIRED" },
    });
    expect(invalid.secrets.values.has("google:subject-1:refresh_token")).toBe(false);
    expect(await invalid.accounts.findById(accountId("account-1"))).not.toBeNull();
    expect(await invalid.accounts.getLastAccountId()).toBeNull();

    invalid.google.exchanges.push(tokenSet("access-new", "refresh-new"));
    invalid.google.identities.push(identity("subject-1", "renewed@example.com"));
    await expect(invalid.service.login()).resolves.toMatchObject({
      account: { email: "renewed@example.com" },
    });
    expect(invalid.secrets.values.has("google:subject-1:refresh_token")).toBe(true);
  });

  it("switches saved accounts without interactive OAuth and preserves other tokens", async () => {
    const setup = makeService();
    const second: GoogleAccount = {
      id: accountId("account-2"),
      subject: "subject-2",
      email: "two@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "one@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.accounts.upsert(second);
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    await setup.tokenStore.setRefreshToken("subject-2", "refresh-2");
    setup.google.refreshHandler = async (refreshToken) =>
      tokenSet(`access-for-${refreshToken}`, refreshToken);

    const session = await setup.service.switchAccount(accountId("account-2"));
    expect(session.account.email).toBe("two@example.com");
    await expect(setup.accessTokens.getAccessToken(accountId("account-2"))).resolves.toBe(
      "access-for-refresh-2",
    );
    expect(setup.oauth.flows).toEqual([]);
    expect(setup.secrets.values.has("google:subject-1:refresh_token")).toBe(true);
    expect(setup.secrets.values.has("google:subject-2:refresh_token")).toBe(true);

    await expect(setup.service.switchAccount(accountId("account-1"))).resolves.toBeTruthy();
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).resolves.toBe(
      "access-for-refresh-1",
    );
    await setup.accessTokens.clearAccessToken(accountId("account-2"));
    await setup.tokenStore.deleteRefreshToken("subject-2");
    await expect(setup.service.switchAccount(accountId("account-2"))).rejects.toMatchObject({
      backendError: { code: "REAUTH_REQUIRED" },
    });
  });

  it("separates logout from revoke while retaining account metadata", async () => {
    const logout = makeService();
    logout.google.exchanges.push(tokenSet("access-1", "refresh-1"));
    logout.google.identities.push(identity("subject-1", "user@example.com"));
    const logoutSession = await logout.service.login();
    await logout.service.logout();
    expect(await logout.accounts.findById(logoutSession.account.id)).not.toBeNull();
    expect(logout.secrets.values.has("google:subject-1:refresh_token")).toBe(false);
    expect(await logout.accounts.getLastAccountId()).toBeNull();

    const revoke = makeService();
    revoke.google.exchanges.push(tokenSet("access-2", "refresh-2"));
    revoke.google.identities.push(identity("subject-2", "two@example.com"));
    const revokeSession = await revoke.service.login();
    await revoke.service.revokeAccess(revokeSession.account.id);
    expect(revoke.google.revokedTokens).toEqual(["refresh-2"]);
    expect(revoke.secrets.values.has("google:subject-2:refresh_token")).toBe(false);
    expect(await revoke.accounts.findById(revokeSession.account.id)).not.toBeNull();
  });

  it("keeps local credentials when remote revocation is not confirmed", async () => {
    const setup = makeService();
    setup.google.exchanges.push(tokenSet("access-1", "refresh-1"));
    setup.google.identities.push(identity("subject-1", "user@example.com"));
    const session = await setup.service.login();
    setup.google.revokeToken = async () => {
      throw new GoogleProviderError("network");
    };

    await expect(setup.service.revokeAccess(session.account.id)).rejects.toMatchObject({
      backendError: { code: "GOOGLE_API_ERROR" },
    });
    expect(setup.secrets.values.has("google:subject-1:refresh_token")).toBe(true);
    expect(await setup.accounts.getLastAccountId()).toBe(session.account.id);
  });

  it("keeps cached file state unchanged when persistence fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-auth-"));
    const path = join(directory, "google-accounts.json");
    try {
      const repository = new FileGoogleAccountRepository(path);
      expect(await repository.list()).toEqual([]);
      await mkdir(path);
      await expect(
        repository.upsert({
          id: accountId("account-1"),
          subject: "subject-1",
          email: "user@example.com",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ backendError: { code: "INTERNAL" } });
      expect(await repository.list()).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("Google access token provider", () => {
  it("reuses unexpired tokens and refreshes near expiry", async () => {
    let now = 1_000_000;
    const setup = makeService({ now: () => now });
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    const refresh = vi.fn(async (refreshToken: string) =>
      tokenSet(`refreshed-${refreshToken}`, refreshToken),
    );
    setup.google.refreshHandler = refresh;
    setup.accessTokens.setAccessToken(accountId("account-1"), tokenSet("cached", "refresh-1"));
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).resolves.toBe("cached");
    expect(refresh).not.toHaveBeenCalled();

    now += 3_540_000;
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).resolves.toBe(
      "refreshed-refresh-1",
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("single-flights three concurrent refreshes and cleans failed flights", async () => {
    const setup = makeService();
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    let resolveRefresh!: (value: GoogleTokenSet) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<GoogleTokenSet>((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValue(tokenSet("access-after-failure", "refresh-1"));
    setup.google.refreshHandler = refresh;

    const first = setup.accessTokens.getAccessToken(accountId("account-1"));
    const second = setup.accessTokens.getAccessToken(accountId("account-1"));
    const third = setup.accessTokens.getAccessToken(accountId("account-1"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolveRefresh(tokenSet("shared-access", "refresh-1"));
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "shared-access",
      "shared-access",
      "shared-access",
    ]);
    expect(refresh).toHaveBeenCalledOnce();

    await setup.accessTokens.clearAccessToken(accountId("account-1"));
    refresh.mockRejectedValueOnce(new GoogleProviderError("api"));
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).rejects.toMatchObject({
      backendError: { code: "GOOGLE_API_ERROR" },
    });
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).resolves.toBe(
      "access-after-failure",
    );
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("keeps refresh single-flight state isolated between accounts", async () => {
    const setup = makeService();
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "one@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.accounts.upsert({
      id: accountId("account-2"),
      subject: "subject-2",
      email: "two@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    await setup.tokenStore.setRefreshToken("subject-2", "refresh-2");
    const resolvers = new Map<string, (value: GoogleTokenSet) => void>();
    const refresh = vi.fn(
      (refreshToken: string) =>
        new Promise<GoogleTokenSet>((resolve) => {
          resolvers.set(refreshToken, resolve);
        }),
    );
    setup.google.refreshHandler = refresh;

    const firstAccount = setup.accessTokens.getAccessToken(accountId("account-1"));
    const secondAccount = setup.accessTokens.getAccessToken(accountId("account-1"));
    const otherAccount = setup.accessTokens.getAccessToken(accountId("account-2"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(refresh).toHaveBeenCalledTimes(2);
    resolvers.get("refresh-1")!(tokenSet("access-1", "refresh-1"));
    resolvers.get("refresh-2")!(tokenSet("access-2", "refresh-2"));
    await expect(Promise.all([firstAccount, secondAccount, otherAccount])).resolves.toEqual([
      "access-1",
      "access-1",
      "access-2",
    ]);
  });

  it("does not let a cleared account accept an in-flight refresh result", async () => {
    const setup = makeService();
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    let resolveRefresh!: (value: GoogleTokenSet) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<GoogleTokenSet>((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValueOnce(tokenSet("fresh-access", "refresh-1"));
    setup.google.refreshHandler = refresh;

    const stale = setup.accessTokens.getAccessToken(accountId("account-1"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const clearing = setup.accessTokens.clearAccessToken(accountId("account-1"));
    resolveRefresh(tokenSet("stale-access", "rotated-refresh"));
    await clearing;

    await expect(stale).rejects.toMatchObject({
      backendError: { code: "UNAUTHENTICATED" },
    });
    expect(setup.secrets.values.get("google:subject-1:refresh_token")).toEqual(
      new TextEncoder().encode("refresh-1"),
    );
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).resolves.toBe(
      "fresh-access",
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("deletes invalid refresh credentials and reports reauthentication", async () => {
    const setup = makeService();
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "revoked");
    setup.google.refreshHandler = async () => {
      throw new GoogleProviderError("invalid_grant");
    };
    await expect(setup.accessTokens.getAccessToken(accountId("account-1"))).rejects.toMatchObject({
      backendError: { code: "REAUTH_REQUIRED" },
    });
    expect(setup.secrets.values.has("google:subject-1:refresh_token")).toBe(false);
    expect(await setup.accounts.findById(accountId("account-1"))).not.toBeNull();
  });
});

describe("Google API authorization retry", () => {
  it("force-refreshes once and retries exactly once after 401", async () => {
    const setup = makeService();
    await setup.accounts.upsert({
      id: accountId("account-1"),
      subject: "subject-1",
      email: "user@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    });
    await setup.tokenStore.setRefreshToken("subject-1", "refresh-1");
    setup.accessTokens.setAccessToken(accountId("account-1"), tokenSet("stale", "refresh-1"));
    setup.google.refreshHandler = async () => tokenSet("fresh", "refresh-1");
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, result: null })
      .mockResolvedValueOnce({ status: 200, result: "ok" });

    await expect(callGoogleApi(accountId("account-1"), setup.accessTokens, request)).resolves.toBe(
      "ok",
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "stale");
    expect(request).toHaveBeenNthCalledWith(2, "fresh");

    await setup.accessTokens.clearAccessToken(accountId("account-1"));
    const second401 = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, result: null })
      .mockResolvedValueOnce({ status: 401, result: null });
    await expect(
      callGoogleApi(accountId("account-1"), setup.accessTokens, second401),
    ).rejects.toMatchObject({
      backendError: { code: "UNAUTHENTICATED" },
    });
    expect(second401).toHaveBeenCalledTimes(2);
  });

  it("maps unexpected provider request failures to a safe API error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("transport detail"));
    const accessTokens = {
      getAccessToken: async () => "access",
      forceRefresh: async () => "fresh",
    };

    await expect(
      callGoogleApi(accountId("account-1"), accessTokens, request),
    ).rejects.toMatchObject({
      backendError: { code: "GOOGLE_API_ERROR", message: "Google request failed" },
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
