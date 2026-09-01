import { describe, expect, it, vi } from "vitest";

import { BackendClientError, callBackend, pingBackend } from "../src/api/backend";
import { VERSIONS, parseRpcRequest } from "@survey-synth/contracts";

describe("typed desktop backend client", () => {
  it("sends system.ping through the generic backend command and parses its response", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = JSON.parse(String(args?.request)) as unknown;
      expect(parseRpcRequest(request)).toMatchObject({ method: "system.ping", params: {} });
      expect((request as { v: number }).v).toBe(VERSIONS.protocolVersion);
      return { ok: true, message: "pong" };
    });

    await expect(pingBackend({ invoke })).resolves.toEqual({ ok: true, message: "pong" });
    expect(invoke).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ request: expect.any(String) }),
    );
  });

  it("preserves structured backend failures", async () => {
    const invoke = vi.fn(async () => {
      throw {
        code: "BACKEND_UNAVAILABLE",
        message: "Sidecar exited",
        recoverable: true,
      };
    });

    await expect(pingBackend({ invoke })).rejects.toEqual(
      new BackendClientError({
        code: "BACKEND_UNAVAILABLE",
        message: "Sidecar exited",
        recoverable: true,
      }),
    );
  });

  it("surfaces invalid request parameters as a structured validation error", async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: "pong" }));

    await expect(callBackend("system.ping", { unexpected: true }, { invoke })).rejects.toEqual(
      new BackendClientError({
        code: "VALIDATION_FAILED",
        message: "Backend request parameters are invalid",
        recoverable: true,
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
