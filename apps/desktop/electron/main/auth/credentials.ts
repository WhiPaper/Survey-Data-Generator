import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { backendFailure } from "../errors";

export interface RefreshTokenStore {
  get(accountId: string): Promise<string | null>;
  set(accountId: string, refreshToken: string): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export type SecretCodec = {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

type StoredSecrets = Record<string, string>;

export class FileRefreshTokenStore implements RefreshTokenStore {
  public constructor(
    private readonly filename: string,
    private readonly codec: SecretCodec,
  ) {}

  public async get(accountId: string): Promise<string | null> {
    this.assertAvailable();
    const values = await this.read();
    const encoded = values[accountId];
    if (encoded === undefined) return null;
    try {
      return this.codec.decrypt(Buffer.from(encoded, "base64"));
    } catch {
      throw backendFailure("REAUTH_REQUIRED", "Saved Google credentials could not be read");
    }
  }

  public async set(accountId: string, refreshToken: string): Promise<void> {
    this.assertAvailable();
    const values = await this.read();
    values[accountId] = this.codec.encrypt(refreshToken).toString("base64");
    await this.write(values);
  }

  public async delete(accountId: string): Promise<void> {
    this.assertAvailable();
    const values = await this.read();
    if (!(accountId in values)) return;
    delete values[accountId];
    await this.write(values);
  }

  private assertAvailable(): void {
    if (!this.codec.isAvailable()) {
      throw backendFailure("BACKEND_UNAVAILABLE", "Secure credential storage is unavailable");
    }
  }

  private async read(): Promise<StoredSecrets> {
    try {
      const raw = JSON.parse(await readFile(this.filename, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw backendFailure("INTERNAL", "Local Google credentials could not be read");
    }
  }

  private async write(values: StoredSecrets): Promise<void> {
    try {
      await mkdir(dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      await writeFile(temporary, JSON.stringify(values), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename);
    } catch {
      throw backendFailure("INTERNAL", "Local Google credentials could not be saved");
    }
  }
}
