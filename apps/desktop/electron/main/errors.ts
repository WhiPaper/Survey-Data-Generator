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

export const normalizeBackendError = (error: unknown): BackendError => {
  if (error instanceof BackendFailure) return error.backendError;
  return {
    code: "INTERNAL",
    message: error instanceof Error && error.message.length > 0 ? error.message : "Unexpected backend error",
    recoverable: true,
  };
};
