import type { Readable, Writable } from "node:stream";

import {
  BackendErrorSchema,
  type BackendError,
  createErrorResponse,
  createSuccessResponse,
  parseRpcRequest,
  type RequestEnvelope,
  type SidecarReady,
  SystemPingResultSchema,
  SystemShutdownResultSchema,
  VERSIONS,
} from "@survey-synth/contracts";

import { NdjsonDecoder, encodeNdjson } from "./ndjson.js";
import type { SafeLogger } from "./logger.js";

export interface SidecarServerOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly logger: SafeLogger;
  readonly onShutdown?: () => void;
}

export interface SidecarServer {
  shutdown(): void;
}

const readyMessage: SidecarReady = {
  type: "ready",
  appVersion: VERSIONS.appVersion,
  protocolVersion: VERSIONS.protocolVersion,
  databaseSchemaVersion: VERSIONS.databaseSchemaVersion,
  domainSchemaVersion: VERSIONS.domainSchemaVersion,
  engineVersion: VERSIONS.engineVersion,
  profilerVersion: VERSIONS.profilerVersion,
};

const validationError = (message: string): BackendError =>
  BackendErrorSchema.parse({
    code: "VALIDATION_FAILED",
    message,
    recoverable: true,
  });

const notFoundError = (method: string): BackendError =>
  BackendErrorSchema.parse({
    code: "NOT_FOUND",
    message: `Unknown backend method: ${method}`,
    recoverable: false,
  });

const internalError = (): BackendError =>
  BackendErrorSchema.parse({
    code: "INTERNAL",
    message: "Sidecar could not process request",
    recoverable: true,
  });

export const createSidecarServer = (options: SidecarServerOptions): SidecarServer => {
  const decoder = new NdjsonDecoder();
  let closing = false;
  let shutdownRequested = false;
  let invalidMessageId = 0;

  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    shutdownRequested = true;
    options.input.pause();
    options.onShutdown?.();
  };

  const writeResponse = (response: unknown, afterWrite?: () => void): void => {
    options.output.write(encodeNdjson(response), afterWrite);
  };

  const responseId = (line: string): string => {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && "id" in value) {
        const id = value.id;
        if (typeof id === "string" && id.length > 0) return id;
      }
    } catch {
      // Invalid JSON has no trustworthy request id.
    }
    invalidMessageId += 1;
    return `invalid_${invalidMessageId}`;
  };

  const handleLine = (line: string): void => {
    const id = responseId(line);
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      writeResponse(createErrorResponse(id, validationError("Request is not valid JSON")));
      return;
    }

    let request: RequestEnvelope;
    try {
      request = parseRpcRequest(raw);
    } catch {
      writeResponse(
        createErrorResponse(id, validationError("Request envelope or parameters are invalid")),
      );
      return;
    }

    try {
      if (request.method === "system.ping") {
        const result = SystemPingResultSchema.parse({ ok: true, message: "pong" });
        writeResponse(createSuccessResponse(request.id, result));
        return;
      }

      if (request.method === "system.shutdown") {
        shutdownRequested = true;
        const result = SystemShutdownResultSchema.parse({ ok: true, message: "shutting_down" });
        writeResponse(createSuccessResponse(request.id, result), shutdown);
        return;
      }

      writeResponse(createErrorResponse(request.id, notFoundError(request.method)));
    } catch {
      writeResponse(createErrorResponse(request.id, internalError()));
    }
  };

  options.output.write(encodeNdjson(readyMessage));
  options.logger.info("sidecar_ready", { protocolVersion: VERSIONS.protocolVersion });

  options.input.on("data", (chunk: string | Uint8Array) => {
    if (closing || shutdownRequested) return;
    for (const line of decoder.push(chunk)) {
      handleLine(line);
      if (closing || shutdownRequested) break;
    }
  });
  options.input.on("end", () => {
    if (closing) return;
    for (const line of decoder.finish()) {
      handleLine(line);
      if (closing || shutdownRequested) break;
    }
    if (!closing && !shutdownRequested) shutdown();
  });

  return { shutdown };
};
