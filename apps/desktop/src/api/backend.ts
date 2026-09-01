import { invoke } from "@tauri-apps/api/core";
import {
  BackendErrorSchema,
  type BackendError,
  type BackendRpc,
  createRequest,
  parseRpcResult,
  type RpcMethod,
} from "@survey-synth/contracts";

export interface BackendInvoker {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export class BackendClientError extends Error {
  public readonly backendError: BackendError;

  public constructor(error: BackendError) {
    super(error.message);
    this.name = "BackendClientError";
    this.backendError = error;
  }
}

const tauriInvoker: BackendInvoker = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
};

let requestSequence = 0;

const nextRequestId = (): string => {
  requestSequence += 1;
  return `ui_${requestSequence}`;
};

const structuredError = (code: BackendError["code"], message: string): BackendError => ({
  code,
  message,
  recoverable:
    code === "VALIDATION_FAILED" || code === "BACKEND_UNAVAILABLE" || code === "INTERNAL",
});

const normalizeError = (value: unknown): BackendError => {
  const parsed = BackendErrorSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : structuredError("BACKEND_UNAVAILABLE", "Backend returned an invalid error");
};

export const callBackend = async <M extends RpcMethod>(
  method: M,
  params: BackendRpc[M]["input"],
  backend: BackendInvoker = tauriInvoker,
): Promise<BackendRpc[M]["output"]> => {
  let request: ReturnType<typeof createRequest<M>>;
  try {
    request = createRequest(nextRequestId(), method, params);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      throw new BackendClientError(
        structuredError("VALIDATION_FAILED", "Backend request parameters are invalid"),
      );
    }
    throw new BackendClientError(normalizeError(error));
  }

  try {
    const rawResponse = await backend.invoke<unknown>("backend_call", {
      request: JSON.stringify(request),
    });
    return parseRpcResult(method, rawResponse);
  } catch (error) {
    if (error instanceof BackendClientError) throw error;
    if (error instanceof Error && error.name === "ZodError") {
      throw new BackendClientError(
        structuredError("INTERNAL", "Backend returned an invalid response"),
      );
    }
    throw new BackendClientError(normalizeError(error));
  }
};

export const pingBackend = (backend?: BackendInvoker) => callBackend("system.ping", {}, backend);
