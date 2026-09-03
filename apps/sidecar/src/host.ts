import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";

import {
  HostCapabilityMethodSchema,
  HostResponseSchema,
  type BackendError,
  type HostCapabilityMethod,
  type HostResponse,
  type HostSecretGetResult,
  HostSecretGetResultSchema,
  HostMutationResultSchema,
  VERSIONS,
} from "@survey-synth/contracts";

import { sidecarError } from "./errors.js";
import { encodeNdjson } from "./rpc/ndjson.js";

export interface SecureSecretStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

type HostCapabilityParams = {
  "host.secret.get": { key: string };
  "host.secret.set": { key: string; value: string };
  "host.secret.delete": { key: string };
  "host.open_external": { url: string };
  "host.dialog.save": { defaultName?: string; filterName?: string; filterExtension?: string };
};

type HostCapabilityResult = {
  "host.secret.get": HostSecretGetResult;
  "host.secret.set": { ok: true };
  "host.secret.delete": { ok: true };
  "host.open_external": { ok: true };
  "host.dialog.save": { path: string | null };
};

interface PendingHostCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

export class HostCapabilityError extends Error {
  public readonly backendError: BackendError;

  public constructor(error: BackendError) {
    super(error.message);
    this.name = "HostCapabilityError";
    this.backendError = error;
  }
}

export interface HostCapabilityClient {
  call<M extends HostCapabilityMethod>(
    method: M,
    params: HostCapabilityParams[M],
  ): Promise<HostCapabilityResult[M]>;
  handleMessage(message: unknown): boolean;
  close(): void;
}

export const createHostCapabilityClient = (output: Writable): HostCapabilityClient => {
  const pending = new Map<string, PendingHostCall>();
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    const error = sidecarError("BACKEND_UNAVAILABLE", "Host capability is unavailable", true);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  const call = <M extends HostCapabilityMethod>(
    method: M,
    params: HostCapabilityParams[M],
  ): Promise<HostCapabilityResult[M]> => {
    if (closed) {
      return Promise.reject(
        sidecarError("BACKEND_UNAVAILABLE", "Host capability is unavailable", true),
      );
    }
    const id = `host_${randomUUID()}`;
    HostCapabilityMethodSchema.parse(method);
    return new Promise<HostCapabilityResult[M]>((resolve, reject) => {
      pending.set(id, {
        reject,
        resolve: (value) => resolve(value as HostCapabilityResult[M]),
      });
      try {
        output.write(
          encodeNdjson({
            v: VERSIONS.protocolVersion,
            type: "host_request",
            id,
            method,
            params,
          }),
        );
      } catch {
        pending.delete(id);
        reject(sidecarError("BACKEND_UNAVAILABLE", "Host capability is unavailable", true));
      }
    });
  };

  const handleMessage = (message: unknown): boolean => {
    if (
      typeof message !== "object" ||
      message === null ||
      (message as { type?: unknown }).type !== "host_response"
    ) {
      return false;
    }

    const parsed = HostResponseSchema.safeParse(message);
    if (!parsed.success) {
      close();
      return true;
    }
    const response: HostResponse = parsed.data;
    const waiter = pending.get(response.id);
    if (!waiter) return true;
    pending.delete(response.id);
    if (response.ok) {
      waiter.resolve(response.result);
    } else {
      waiter.reject(new HostCapabilityError(response.error));
    }
    return true;
  };

  return { call, handleMessage, close };
};

const secretKey = (subject: string): string => `google:${subject}:refresh_token`;

export class RemoteGoogleTokenStore implements GoogleTokenStore {
  public constructor(private readonly secrets: SecureSecretStore) {}

  public async getRefreshToken(subject: string): Promise<string | null> {
    const value = await this.secrets.get(secretKey(subject));
    if (value === null) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      throw sidecarError("INTERNAL", "Secure secret store returned invalid data", true);
    }
  }

  public setRefreshToken(subject: string, token: string): Promise<void> {
    return this.secrets.set(secretKey(subject), new TextEncoder().encode(token));
  }

  public deleteRefreshToken(subject: string): Promise<void> {
    return this.secrets.delete(secretKey(subject));
  }
}

export interface GoogleTokenStore {
  getRefreshToken(subject: string): Promise<string | null>;
  setRefreshToken(subject: string, token: string): Promise<void>;
  deleteRefreshToken(subject: string): Promise<void>;
}

export class RemoteSecureSecretStore implements SecureSecretStore {
  public constructor(private readonly host: HostCapabilityClient) {}

  public async get(key: string): Promise<Uint8Array | null> {
    const raw = await this.host.call("host.secret.get", { key });
    const result = HostSecretGetResultSchema.parse(raw);
    if (result.value === null) return null;
    const decoded = Buffer.from(result.value, "base64");
    if (decoded.toString("base64") !== result.value) {
      throw sidecarError("INTERNAL", "Secure secret store returned invalid data", true);
    }
    return Uint8Array.from(decoded);
  }

  public async set(key: string, value: Uint8Array): Promise<void> {
    HostMutationResultSchema.parse(
      await this.host.call("host.secret.set", {
        key,
        value: Buffer.from(value).toString("base64"),
      }),
    );
  }

  public async delete(key: string): Promise<void> {
    HostMutationResultSchema.parse(await this.host.call("host.secret.delete", { key }));
  }
}
