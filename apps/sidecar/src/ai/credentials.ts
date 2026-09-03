import { sidecarError } from "../errors.js";
import type { SecureSecretStore } from "../host.js";

const OPENAI_SECRET_KEY = "llm:openai:api_key";

export class LlmCredentialStore {
  private readonly secrets: SecureSecretStore;

  constructor(secrets: SecureSecretStore) {
    this.secrets = secrets;
  }

  async getApiKey(): Promise<string | null> {
    const raw = await this.secrets.get(OPENAI_SECRET_KEY);
    if (raw === null) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw sidecarError("INTERNAL", "Secure secret store returned invalid key data", true);
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      throw sidecarError("VALIDATION_FAILED", "API key cannot be empty", false);
    }
    await this.secrets.set(OPENAI_SECRET_KEY, new TextEncoder().encode(trimmed));
  }

  async deleteApiKey(): Promise<void> {
    await this.secrets.delete(OPENAI_SECRET_KEY);
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return key !== null && key.trim().length > 0;
  }
}
