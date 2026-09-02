import { describe, expect, it } from "vitest";

import {
  BackendErrorSchema,
  VERSIONS,
  parseRpcResult,
  assertCompatibleReady,
  createPingRequest,
  parseRpcRequest,
  parseSidecarReady,
} from "../src/index.js";

describe("shared RPC contracts", () => {
  it("parses a valid system.ping request", () => {
    expect(parseRpcRequest(createPingRequest("r_1"))).toEqual({
      v: VERSIONS.protocolVersion,
      type: "request",
      id: "r_1",
      method: "system.ping",
      params: {},
    });
  });

  it("rejects invalid method parameters", () => {
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_2",
        method: "system.ping",
        params: { unexpected: true },
      }),
    ).toThrow();
  });

  it("validates the complete ready handshake and exact compatibility", () => {
    const ready = parseSidecarReady({
      type: "ready",
      appVersion: VERSIONS.appVersion,
      protocolVersion: VERSIONS.protocolVersion,
      databaseSchemaVersion: VERSIONS.databaseSchemaVersion,
      domainSchemaVersion: VERSIONS.domainSchemaVersion,
      engineVersion: VERSIONS.engineVersion,
      profilerVersion: VERSIONS.profilerVersion,
    });

    expect(assertCompatibleReady(ready)).toEqual(ready);
    expect(() => assertCompatibleReady({ ...ready, appVersion: "9.9.9" })).toThrow(
      "Incompatible sidecar version or protocol",
    );
    expect(() =>
      assertCompatibleReady({ ...ready, protocolVersion: VERSIONS.protocolVersion + 1 }),
    ).toThrow("Incompatible sidecar version or protocol");
    expect(() => parseSidecarReady({ ...ready, profilerVersion: "0" })).toThrow();
  });

  it("accepts only structured backend errors", () => {
    expect(
      BackendErrorSchema.parse({
        code: "BACKEND_UNAVAILABLE",
        message: "Sidecar exited",
        recoverable: true,
      }),
    ).toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    expect(() => BackendErrorSchema.parse({ message: "raw string error" })).toThrow();
  });

  it("validates method results at the shared contract boundary", () => {
    expect(parseRpcResult("system.ping", { ok: true, message: "pong" })).toEqual({
      ok: true,
      message: "pong",
    });
    expect(() => parseRpcResult("system.ping", { ok: true, message: "not-pong" })).toThrow();
    expect(
      parseRpcResult("session.get", {
        account: { id: "account-1", email: "user@example.com" },
      }),
    ).toEqual({ account: { id: "account-1", email: "user@example.com" } });
    expect(() =>
      parseRpcResult("session.get", {
        account: { id: "account-1", email: "user@example.com", accessToken: "secret" },
      }),
    ).toThrow();
  });

  it("validates host capability messages separately from frontend RPC", () => {
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_auth",
        method: "auth.switchAccount",
        params: { id: "account-1" },
      }),
    ).not.toThrow();
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_auth",
        method: "auth.switchAccount",
        params: {},
      }),
    ).toThrow();
  });
});
