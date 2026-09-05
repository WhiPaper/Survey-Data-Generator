import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleAccountId } from "@survey-synth/domain";
import { FileRefreshTokenStore, type RefreshTokenStore } from "../electron/main/auth/credentials";
import type { GoogleProvider } from "../electron/main/auth/google-provider";
import { createGoogleAuthService } from "../electron/main/auth/service";
import { openAppDatabase, type AppDatabase } from "../electron/main/persistence/database";
import { getActiveGoogleAccountId, getGoogleAccount } from "../electron/main/persistence/store";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const databases: AppDatabase[] = [];
const tempDirectories: string[] = [];

const createDatabase = (): AppDatabase => {
  const database = openAppDatabase({ filename: ":memory:", migrationsFolder });
  databases.push(database);
  return database;
};

const memoryTokenStore = (): RefreshTokenStore & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    get: async (id) => values.get(id) ?? null,
    set: async (id, token) => void values.set(id, token),
    delete: async (id) => void values.delete(id),
  };
};

const provider = (): GoogleProvider & {
  authorize: ReturnType<typeof vi.fn<GoogleProvider["authorize"]>>;
  refresh: ReturnType<typeof vi.fn<GoogleProvider["refresh"]>>;
  revoke: ReturnType<typeof vi.fn<GoogleProvider["revoke"]>>;
} => ({
  authorize: vi.fn(async () => ({
    identity: { subject: "google-sub-1", email: "user@example.com", displayName: "Survey User" },
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAtMs: 100_000,
  })),
  refresh: vi.fn(async () => ({ accessToken: "access-refreshed", expiresAtMs: 200_000 })),
  revoke: vi.fn(async () => undefined),
});

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("Google auth service", () => {
  it("persists Google account metadata and restores the active session locally", async () => {
    const database = createDatabase();
    const refreshTokens = memoryTokenStore();
    const google = provider();
    const auth = createGoogleAuthService({ database: undefined } as never);
    void auth;

    const service = createGoogleAuthService({
      db: database.db,
      refreshTokens,
      google,
      now: () => 1_000,
    });

    await expect(service.login()).resolves.toEqual({
      account: { id: "google-sub-1", email: "user@example.com", displayName: "Survey User" },
    });
    expect(refreshTokens.values.get("google-sub-1")).toBe("refresh-1");
    expect(getActiveGoogleAccountId(database.db)).toBe("google-sub-1");
    expect(getGoogleAccount(database.db, "google-sub-1")?.email).toBe("user@example.com");

    const restored = createGoogleAuthService({
      db: database.db,
      refreshTokens,
      google: provider(),
      now: () => 2_000,
    });
    await expect(restored.getSession()).resolves.toEqual({
      account: { id: "google-sub-1", email: "user@example.com", displayName: "Survey User" },
    });
  });

  it("refreshes access tokens on demand without exposing the refresh token", async () => {
    const database = createDatabase();
    const refreshTokens = memoryTokenStore();
    const google = provider();
    const service = createGoogleAuthService({
      db: database.db,
      refreshTokens,
      google,
      now: () => 1_000,
    });
    await service.login();

    const restoredGoogle = provider();
    const restored = createGoogleAuthService({
      db: database.db,
      refreshTokens,
      google: restoredGoogle,
      now: () => 2_000,
    });

    await expect(restored.getAccessToken("google-sub-1" as GoogleAccountId)).resolves.toBe(
      "access-refreshed",
    );
    expect(restoredGoogle.refresh).toHaveBeenCalledWith("refresh-1");
  });

  it("logout removes the active refresh token but keeps local account metadata", async () => {
    const database = createDatabase();
    const refreshTokens = memoryTokenStore();
    const service = createGoogleAuthService({
      db: database.db,
      refreshTokens,
      google: provider(),
      now: () => 1_000,
    });
    await service.login();
    await service.logout();

    expect(refreshTokens.values.has("google-sub-1")).toBe(false);
    expect(getActiveGoogleAccountId(database.db)).toBeNull();
    expect(getGoogleAccount(database.db, "google-sub-1")).not.toBeNull();
    await expect(service.getSession()).resolves.toBeNull();
  });
});

describe("refresh token file store", () => {
  it("stores only codec-encrypted bytes on disk and round-trips them", async () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-synth-auth-"));
    tempDirectories.push(directory);
    const store = new FileRefreshTokenStore(join(directory, "tokens.json"), {
      isAvailable: () => true,
      encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
    });

    await store.set("account-1", "secret-refresh-token");
    await expect(store.get("account-1")).resolves.toBe("secret-refresh-token");
    await store.delete("account-1");
    await expect(store.get("account-1")).resolves.toBeNull();
  });
});
