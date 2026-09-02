import { sidecarError } from "../errors.js";

/** Temporary M2 import safeguards; durable/streaming persistence belongs to M3. */
export const M2_IMPORT_MAX_RESPONSES = 25_000;
export const M2_IMPORT_MAX_BYTES = 128 * 1024 * 1024;
export const M2_IMPORT_TIMEOUT_MS = 5 * 60 * 1_000;

export interface M2ImportLimits {
  readonly maxResponses: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_M2_IMPORT_LIMITS: M2ImportLimits = {
  maxResponses: M2_IMPORT_MAX_RESPONSES,
  maxBytes: M2_IMPORT_MAX_BYTES,
  timeoutMs: M2_IMPORT_TIMEOUT_MS,
};

export type M2ImportLimitReason = "response_limit" | "payload_limit" | "time_limit";

export class M2ImportSafetyBudget {
  public readonly deadlineAt: number;
  private responseCount = 0;
  private payloadBytes = 0;

  public constructor(
    private readonly limits: M2ImportLimits = DEFAULT_M2_IMPORT_LIMITS,
    private readonly now: () => number = Date.now,
    startedAt = now(),
  ) {
    this.deadlineAt = startedAt + limits.timeoutMs;
  }

  public check(signal?: AbortSignal): void {
    if (signal?.aborted) throw cancelledError();
    if (this.now() >= this.deadlineAt) throw m2ImportLimitError("time_limit");
  }

  public addResponses(count: number, signal?: AbortSignal): void {
    this.check(signal);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw sidecarError("VALIDATION_FAILED", "Google response count is invalid", true);
    }
    if (this.responseCount > this.limits.maxResponses - count) {
      throw m2ImportLimitError("response_limit");
    }
    this.responseCount += count;
  }

  public addPayload(bytes: number, signal?: AbortSignal): void {
    this.check(signal);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw sidecarError("VALIDATION_FAILED", "Google provider payload size is invalid", true);
    }
    if (this.payloadBytes > this.limits.maxBytes - bytes) {
      throw m2ImportLimitError("payload_limit");
    }
    this.payloadBytes += bytes;
  }

  public get acceptedResponses(): number {
    return this.responseCount;
  }

  public get acceptedPayloadBytes(): number {
    return this.payloadBytes;
  }
}

export const providerPayloadBytes = (value: unknown): number => {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "payloadBytes")) {
    const explicit = value.payloadBytes;
    if (typeof explicit !== "number" || !Number.isSafeInteger(explicit) || explicit < 0) {
      throw sidecarError("VALIDATION_FAILED", "Google provider payload size is invalid", true);
    }
    return explicit;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw sidecarError("VALIDATION_FAILED", "Google provider payload size is unavailable", true);
  }
};

export const m2ImportLimitError = (reason: M2ImportLimitReason): ReturnType<typeof sidecarError> =>
  sidecarError("VALIDATION_FAILED", "Google Form import exceeded a temporary safety limit", true, {
    reason,
  });

const cancelledError = (): ReturnType<typeof sidecarError> =>
  sidecarError("JOB_CANCELLED", "Form import was cancelled", true);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
