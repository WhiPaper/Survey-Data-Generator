import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { GoogleAccount, GoogleAccountId } from "@survey-synth/domain";

import { sidecarError } from "../errors.js";

export interface GoogleAccountRepository {
  list(): Promise<GoogleAccount[]>;
  findById(id: GoogleAccountId): Promise<GoogleAccount | null>;
  findBySubject(subject: string): Promise<GoogleAccount | null>;
  upsert(account: GoogleAccount): Promise<void>;
  remove(id: GoogleAccountId): Promise<void>;
  getLastAccountId(): Promise<GoogleAccountId | null>;
  setLastAccountId(id: GoogleAccountId | null): Promise<void>;
}

interface AccountStoreState {
  version: 1;
  lastAccountId: string | null;
  accounts: GoogleAccount[];
}

const emptyState = (): AccountStoreState => ({
  version: 1,
  lastAccountId: null,
  accounts: [],
});

const cloneAccount = (account: GoogleAccount): GoogleAccount => ({ ...account });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isHttpsUrl = (value: unknown): value is string =>
  isNonEmptyString(value) && value.startsWith("https://");

const parseAccount = (value: unknown): GoogleAccount | null => {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.subject) ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.lastUsedAt)
  ) {
    return null;
  }
  if (value.displayName !== undefined && !isNonEmptyString(value.displayName)) return null;
  if (value.avatarUrl !== undefined && !isHttpsUrl(value.avatarUrl)) return null;
  return {
    id: value.id as GoogleAccountId,
    subject: value.subject,
    email: value.email,
    ...(value.displayName === undefined ? {} : { displayName: value.displayName }),
    ...(value.avatarUrl === undefined ? {} : { avatarUrl: value.avatarUrl }),
    createdAt: value.createdAt,
    lastUsedAt: value.lastUsedAt,
  };
};

const parseState = (value: unknown): AccountStoreState => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.accounts)) {
    throw sidecarError("INTERNAL", "Local account state is invalid", true);
  }
  const accounts = value.accounts.map(parseAccount);
  if (accounts.some((account) => account === null)) {
    throw sidecarError("INTERNAL", "Local account state is invalid", true);
  }
  const parsedAccounts = accounts as GoogleAccount[];
  const ids = new Set<string>();
  const subjects = new Set<string>();
  for (const account of parsedAccounts) {
    if (ids.has(account.id) || subjects.has(account.subject)) {
      throw sidecarError("INTERNAL", "Local account state contains duplicates", true);
    }
    ids.add(account.id);
    subjects.add(account.subject);
  }
  if (value.lastAccountId !== null && !isNonEmptyString(value.lastAccountId)) {
    throw sidecarError("INTERNAL", "Local account state is invalid", true);
  }
  const lastAccountId =
    value.lastAccountId !== null &&
    parsedAccounts.some((account) => account.id === value.lastAccountId)
      ? value.lastAccountId
      : null;
  return {
    version: 1,
    lastAccountId,
    accounts: parsedAccounts.map(cloneAccount),
  };
};

export class MemoryGoogleAccountRepository implements GoogleAccountRepository {
  private accounts: GoogleAccount[];
  private lastAccountId: GoogleAccountId | null;

  public constructor(
    initial: readonly GoogleAccount[] = [],
    lastAccountId: GoogleAccountId | null = null,
  ) {
    this.accounts = initial.map(cloneAccount);
    this.lastAccountId = lastAccountId;
  }

  public async list(): Promise<GoogleAccount[]> {
    return this.accounts.map(cloneAccount);
  }

  public async findById(id: GoogleAccountId): Promise<GoogleAccount | null> {
    const account = this.accounts.find((candidate) => candidate.id === id);
    return account === undefined ? null : cloneAccount(account);
  }

  public async findBySubject(subject: string): Promise<GoogleAccount | null> {
    const account = this.accounts.find((candidate) => candidate.subject === subject);
    return account === undefined ? null : cloneAccount(account);
  }

  public async upsert(account: GoogleAccount): Promise<void> {
    const subjectConflict = this.accounts.find(
      (candidate) => candidate.subject === account.subject && candidate.id !== account.id,
    );
    if (subjectConflict !== undefined) {
      throw sidecarError("INTERNAL", "Local account identity is inconsistent", true);
    }
    const index = this.accounts.findIndex((candidate) => candidate.id === account.id);
    if (index === -1) {
      this.accounts.push(cloneAccount(account));
    } else {
      this.accounts[index] = cloneAccount(account);
    }
  }

  public async remove(id: GoogleAccountId): Promise<void> {
    this.accounts = this.accounts.filter((account) => account.id !== id);
    if (this.lastAccountId === id) this.lastAccountId = null;
  }

  public async getLastAccountId(): Promise<GoogleAccountId | null> {
    return this.lastAccountId;
  }

  public async setLastAccountId(id: GoogleAccountId | null): Promise<void> {
    this.lastAccountId = id;
  }
}

export class FileGoogleAccountRepository implements GoogleAccountRepository {
  private state: AccountStoreState | null = null;
  private operation: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public list(): Promise<GoogleAccount[]> {
    return this.withState((state) => state.accounts.map(cloneAccount));
  }

  public findById(id: GoogleAccountId): Promise<GoogleAccount | null> {
    return this.withState((state) => {
      const account = state.accounts.find((candidate) => candidate.id === id);
      return account === undefined ? null : cloneAccount(account);
    });
  }

  public findBySubject(subject: string): Promise<GoogleAccount | null> {
    return this.withState((state) => {
      const account = state.accounts.find((candidate) => candidate.subject === subject);
      return account === undefined ? null : cloneAccount(account);
    });
  }

  public upsert(account: GoogleAccount): Promise<void> {
    return this.mutate((state) => {
      const subjectConflict = state.accounts.find(
        (candidate) => candidate.subject === account.subject && candidate.id !== account.id,
      );
      if (subjectConflict !== undefined) {
        throw sidecarError("INTERNAL", "Local account identity is inconsistent", true);
      }
      const index = state.accounts.findIndex((candidate) => candidate.id === account.id);
      if (index === -1) state.accounts.push(cloneAccount(account));
      else state.accounts[index] = cloneAccount(account);
    });
  }

  public remove(id: GoogleAccountId): Promise<void> {
    return this.mutate((state) => {
      state.accounts = state.accounts.filter((account) => account.id !== id);
      if (state.lastAccountId === id) state.lastAccountId = null;
    });
  }

  public getLastAccountId(): Promise<GoogleAccountId | null> {
    return this.withState((state) => state.lastAccountId as GoogleAccountId | null);
  }

  public setLastAccountId(id: GoogleAccountId | null): Promise<void> {
    return this.mutate((state) => {
      state.lastAccountId = id;
    });
  }

  private async load(): Promise<AccountStoreState> {
    if (this.state !== null) return this.state;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.state = emptyState();
        return this.state;
      }
      throw sidecarError("INTERNAL", "Local account state could not be read", true);
    }
    try {
      this.state = parseState(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "SidecarError") throw error;
      throw sidecarError("INTERNAL", "Local account state could not be read", true);
    }
    return this.state;
  }

  private withState<T>(read: (state: AccountStoreState) => T): Promise<T> {
    return this.enqueue(async () => read(await this.load()));
  }

  private mutate(change: (state: AccountStoreState) => void): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.load();
      const next: AccountStoreState = {
        version: 1,
        lastAccountId: current.lastAccountId,
        accounts: current.accounts.map(cloneAccount),
      };
      change(next);
      await this.save(next);
      this.state = next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(operation);
    void current.then(release, release);
    return current;
  }

  private async save(state: AccountStoreState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch {
      await unlink(temporaryPath).catch(() => undefined);
      throw sidecarError("INTERNAL", "Local account state could not be saved", true);
    }
  }
}

const isNodeError = (value: unknown): value is Error & { code?: string } =>
  value instanceof Error && "code" in value;
