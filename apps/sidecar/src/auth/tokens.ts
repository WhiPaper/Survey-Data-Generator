import type { GoogleAccountId } from "@survey-synth/domain";

import { sidecarError, SidecarError } from "../errors.js";
import type { GoogleAccountRepository } from "./account-store.js";
import {
  GoogleProviderError,
  type GoogleTokenClient,
  mapGoogleProviderError,
  type GoogleTokenSet,
} from "./google.js";
import type { GoogleTokenStore } from "../host.js";

export const ACCESS_TOKEN_SAFETY_MARGIN_MS = 60_000;

export interface GoogleAccessTokenProvider {
  getAccessToken(accountId: GoogleAccountId): Promise<string>;
  forceRefresh(accountId: GoogleAccountId): Promise<string>;
}

export class InMemoryGoogleAccessTokenProvider implements GoogleAccessTokenProvider {
  private readonly accessTokens = new Map<GoogleAccountId, AccessTokenState>();
  private readonly inFlight = new Map<GoogleAccountId, InFlightRefresh>();
  private readonly generations = new Map<GoogleAccountId, number>();

  public constructor(
    private readonly accounts: GoogleAccountRepository,
    private readonly tokenStore: GoogleTokenStore,
    private readonly google: GoogleTokenClient,
    private readonly now: () => number = Date.now,
    private readonly safetyMarginMs = ACCESS_TOKEN_SAFETY_MARGIN_MS,
  ) {}

  public getAccessToken(accountId: GoogleAccountId): Promise<string> {
    const generation = this.currentGeneration(accountId);
    const current = this.accessTokens.get(accountId);
    if (current !== undefined && this.now() < current.expiresAt - this.safetyMarginMs) {
      return Promise.resolve(current.token);
    }
    const existing = this.inFlight.get(accountId);
    if (existing?.generation === generation) return existing.promise;
    if (existing !== undefined) this.inFlight.delete(accountId);
    const refresh = this.refresh(accountId, generation);
    this.inFlight.set(accountId, { generation, promise: refresh });
    void refresh.then(
      () => this.clearInFlight(accountId, refresh),
      () => this.clearInFlight(accountId, refresh),
    );
    return refresh;
  }

  public forceRefresh(accountId: GoogleAccountId): Promise<string> {
    this.accessTokens.delete(accountId);
    return this.getAccessToken(accountId);
  }

  public setAccessToken(accountId: GoogleAccountId, tokenSet: GoogleTokenSet): void {
    this.advanceGeneration(accountId);
    this.accessTokens.set(accountId, {
      token: tokenSet.accessToken,
      expiresAt: this.now() + tokenSet.expiresInSeconds * 1000,
    });
  }

  public async clearAccessToken(accountId: GoogleAccountId): Promise<void> {
    this.advanceGeneration(accountId);
    this.accessTokens.delete(accountId);
    const existing = this.inFlight.get(accountId);
    if (existing !== undefined) {
      this.inFlight.delete(accountId);
      await existing.promise.catch(() => undefined);
    }
  }

  private async refresh(accountId: GoogleAccountId, generation: number): Promise<string> {
    const account = await this.accounts.findById(accountId);
    this.assertCurrent(accountId, generation);
    if (account === null) {
      throw sidecarError("NOT_FOUND", "Google account was not found", true);
    }

    let refreshToken: string | null;
    try {
      refreshToken = await this.tokenStore.getRefreshToken(account.subject);
    } catch {
      throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
    }
    this.assertCurrent(accountId, generation);
    if (refreshToken === null || refreshToken.length === 0) {
      throw sidecarError("REAUTH_REQUIRED", "Google account requires authentication", true);
    }

    let tokenSet: GoogleTokenSet;
    try {
      tokenSet = await this.google.refreshAccessToken(refreshToken);
    } catch (error: unknown) {
      if (error instanceof GoogleProviderError && error.kind === "invalid_grant") {
        this.assertCurrent(accountId, generation);
        this.accessTokens.delete(accountId);
        try {
          await this.tokenStore.deleteRefreshToken(account.subject);
        } catch {
          throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
        }
        throw sidecarError("REAUTH_REQUIRED", "Google authentication must be renewed", true);
      }
      if (error instanceof SidecarError) throw error;
      throw mapGoogleProviderError(error, "Google token refresh failed");
    }

    this.assertCurrent(accountId, generation);
    if (tokenSet.refreshToken !== undefined) {
      try {
        await this.tokenStore.setRefreshToken(account.subject, tokenSet.refreshToken);
      } catch {
        throw sidecarError("INTERNAL", "Secure token storage is unavailable", true);
      }
    }
    this.assertCurrent(accountId, generation);
    this.setAccessToken(accountId, tokenSet);
    return tokenSet.accessToken;
  }

  private currentGeneration(accountId: GoogleAccountId): number {
    return this.generations.get(accountId) ?? 0;
  }

  private advanceGeneration(accountId: GoogleAccountId): number {
    const generation = this.currentGeneration(accountId) + 1;
    this.generations.set(accountId, generation);
    return generation;
  }

  private assertCurrent(accountId: GoogleAccountId, generation: number): void {
    if (this.currentGeneration(accountId) !== generation) {
      throw sidecarError("UNAUTHENTICATED", "Google authentication session changed", true);
    }
  }

  private clearInFlight(accountId: GoogleAccountId, promise: Promise<string>): void {
    if (this.inFlight.get(accountId)?.promise === promise) this.inFlight.delete(accountId);
  }
}

interface AccessTokenState {
  readonly token: string;
  readonly expiresAt: number;
}

interface InFlightRefresh {
  readonly generation: number;
  readonly promise: Promise<string>;
}
