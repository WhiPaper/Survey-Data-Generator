import { z } from "zod";

import { VERSIONS } from "./version.js";

export const BackendErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "REAUTH_REQUIRED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "TARGET_CONFLICT",
  "GOOGLE_API_ERROR",
  "RATE_LIMITED",
  "JOB_CANCELLED",
  "BACKEND_UNAVAILABLE",
  "INTERNAL",
]);

export type BackendErrorCode = z.infer<typeof BackendErrorCodeSchema>;

export const BackendErrorSchema = z
  .object({
    code: BackendErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    recoverable: z.boolean(),
  })
  .strict();

export type BackendError = z.infer<typeof BackendErrorSchema>;

export const RequestEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("request"),
    id: z.string().min(1),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

export const SuccessResponseEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("response"),
    id: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict();

export const ErrorResponseEnvelopeSchema = z
  .object({
    v: z.literal(VERSIONS.protocolVersion),
    type: z.literal("response"),
    id: z.string().min(1),
    ok: z.literal(false),
    error: BackendErrorSchema,
  })
  .strict();

export const ResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  SuccessResponseEnvelopeSchema,
  ErrorResponseEnvelopeSchema,
]);

export type SuccessResponseEnvelope = z.infer<typeof SuccessResponseEnvelopeSchema>;
export type ErrorResponseEnvelope = z.infer<typeof ErrorResponseEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;

export const SidecarReadySchema = z
  .object({
    type: z.literal("ready"),
    appVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
    databaseSchemaVersion: z.number().int().nonnegative(),
    domainSchemaVersion: z.number().int().nonnegative(),
    engineVersion: z.number().int().nonnegative(),
    profilerVersion: z.number().int().nonnegative(),
  })
  .strict();

export type SidecarReady = z.infer<typeof SidecarReadySchema>;

export const SystemPingParamsSchema = z.object({}).strict();
export type SystemPingParams = z.infer<typeof SystemPingParamsSchema>;

export const SystemPingResultSchema = z
  .object({
    ok: z.literal(true),
    message: z.literal("pong"),
  })
  .strict();

export type SystemPingResult = z.infer<typeof SystemPingResultSchema>;

export const SystemShutdownParamsSchema = z.object({}).strict();
export type SystemShutdownParams = z.infer<typeof SystemShutdownParamsSchema>;

export const SystemShutdownResultSchema = z
  .object({
    ok: z.literal(true),
    message: z.literal("shutting_down"),
  })
  .strict();

export type SystemShutdownResult = z.infer<typeof SystemShutdownResultSchema>;

export interface BackendRpc {
  "system.ping": {
    input: SystemPingParams;
    output: SystemPingResult;
  };
  "system.shutdown": {
    input: SystemShutdownParams;
    output: SystemShutdownResult;
  };
}

export type RpcMethod = keyof BackendRpc;

const rpcResultSchemas = {
  "system.ping": SystemPingResultSchema,
  "system.shutdown": SystemShutdownResultSchema,
} satisfies {
  [M in RpcMethod]: z.ZodType<BackendRpc[M]["output"]>;
};

const parseKnownParams = (method: string, params: unknown): void => {
  if (method === "system.ping") {
    SystemPingParamsSchema.parse(params);
  } else if (method === "system.shutdown") {
    SystemShutdownParamsSchema.parse(params);
  }
};

export const parseRpcRequest = (input: unknown): RequestEnvelope => {
  const request = RequestEnvelopeSchema.parse(input);
  parseKnownParams(request.method, request.params);
  return request;
};

export const parseSidecarReady = (input: unknown): SidecarReady => SidecarReadySchema.parse(input);

export const assertCompatibleReady = (ready: SidecarReady): SidecarReady => {
  if (
    ready.appVersion !== VERSIONS.appVersion ||
    ready.protocolVersion !== VERSIONS.protocolVersion
  ) {
    throw new Error("Incompatible sidecar version or protocol");
  }
  return ready;
};

export const parseResponseEnvelope = (input: unknown): ResponseEnvelope =>
  ResponseEnvelopeSchema.parse(input);

export const parseRpcResult = <M extends RpcMethod>(
  method: M,
  input: unknown,
): BackendRpc[M]["output"] => {
  return rpcResultSchemas[method].parse(input) as BackendRpc[M]["output"];
};

export const createRequest = <M extends RpcMethod>(
  id: string,
  method: M,
  params: BackendRpc[M]["input"],
): RequestEnvelope => {
  const request = { v: VERSIONS.protocolVersion, type: "request", id, method, params };
  return parseRpcRequest(request);
};

export const createPingRequest = (id: string): RequestEnvelope =>
  createRequest(id, "system.ping", {});

export const createShutdownRequest = (id: string): RequestEnvelope =>
  createRequest(id, "system.shutdown", {});

export const createSuccessResponse = (id: string, result: unknown): SuccessResponseEnvelope =>
  SuccessResponseEnvelopeSchema.parse({
    v: VERSIONS.protocolVersion,
    type: "response",
    id,
    ok: true,
    result,
  });

export const createErrorResponse = (id: string, error: BackendError): ErrorResponseEnvelope =>
  ErrorResponseEnvelopeSchema.parse({
    v: VERSIONS.protocolVersion,
    type: "response",
    id,
    ok: false,
    error,
  });
