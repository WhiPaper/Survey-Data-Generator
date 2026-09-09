import type { BackendError, BackendErrorCode } from "@survey-synth/contracts";

export class BackendFailure extends Error {
  public constructor(public readonly backendError: BackendError) {
    super(backendError.message);
    this.name = "BackendFailure";
  }
}

export const backendFailure = (
  code: BackendErrorCode,
  message: string,
  recoverable = true,
): BackendFailure => new BackendFailure({ code, message, recoverable });

export const normalizeBackendError = (
  error: unknown,
  options: { exposeInternalDetails?: boolean } = {},
): BackendError => {
  if (error instanceof BackendFailure && error.backendError.code !== "INTERNAL") {
    return error.backendError;
  }
  if (options.exposeInternalDetails) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: "INTERNAL",
      message: message || "Unknown backend error",
      details: error instanceof Error && error.stack ? { stack: error.stack } : undefined,
      recoverable: true,
    };
  }
  return {
    code: "INTERNAL",
    message: "Unexpected backend error",
    recoverable: true,
  };
};
