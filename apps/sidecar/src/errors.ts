import {
  BackendErrorSchema,
  type BackendError,
  type BackendErrorCode,
} from "@survey-synth/contracts";

export class SidecarError extends Error {
  public readonly backendError: BackendError;

  public constructor(error: BackendError) {
    super(error.message);
    this.name = "SidecarError";
    this.backendError = error;
  }
}

export const sidecarError = (
  code: BackendErrorCode,
  message: string,
  recoverable: boolean,
): SidecarError =>
  new SidecarError(
    BackendErrorSchema.parse({
      code,
      message,
      recoverable,
    }),
  );

export const isSidecarError = (value: unknown): value is SidecarError =>
  value instanceof SidecarError;
