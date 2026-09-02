/** Minimal public marker retained from the M0 package surface. */
export type DomainPackage = "domain";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type GoogleAccountId = Brand<string, "GoogleAccountId">;

export interface GoogleAccount {
  id: GoogleAccountId;
  subject: string;
  email: string;
  displayName?: string;
  createdAt: string;
  lastUsedAt: string;
}
