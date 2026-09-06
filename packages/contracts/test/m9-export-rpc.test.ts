import { describe, expect, it } from "vitest";

import { VERSIONS, parseRpcRequest, parseRpcResult } from "../src/index.js";

describe("M9 export RPC contract", () => {
  it("accepts only a run id and supported export format", () => {
    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "export-1",
        method: "runs.export",
        params: { runId: "run-1", format: "csv" },
      }),
    ).toMatchObject({ method: "runs.export", params: { runId: "run-1", format: "csv" } });

    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "export-path",
        method: "runs.export",
        params: { runId: "run-1", format: "csv", destination: "C:/tmp/result.csv" },
      }),
    ).toThrow();

    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "export-json",
        method: "runs.export",
        params: { runId: "run-1", format: "json" },
      }),
    ).toThrow();
  });

  it("returns only saved or cancelled status, never file bytes or paths", () => {
    expect(parseRpcResult("runs.export", { status: "saved" })).toEqual({ status: "saved" });
    expect(parseRpcResult("runs.export", { status: "cancelled" })).toEqual({
      status: "cancelled",
    });
    expect(() =>
      parseRpcResult("runs.export", {
        status: "saved",
        path: "C:/tmp/result.csv",
        bytes: [1, 2, 3],
      }),
    ).toThrow();
  });
});
