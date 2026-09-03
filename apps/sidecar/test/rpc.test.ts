import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { NdjsonDecoder } from "../src/rpc/ndjson.js";
import {
  stderrLogger,
  type SafeLogFields,
  type SafeLogger,
  createSidecarServer,
} from "../src/rpc/index.js";
import { VERSIONS, parseResponseEnvelope, parseSidecarReady } from "@survey-synth/contracts";

const silentLogger: SafeLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

describe("sidecar NDJSON boundary", () => {
  it("keeps log fields allowlisted", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      stderrLogger.info("sidecar_ready", {
        protocolVersion: 1,
        leakedAnswer: "must-not-be-logged",
      } as unknown as SafeLogFields);
      expect(write).toHaveBeenCalledWith(
        '{"level":"info","event":"sidecar_ready","protocolVersion":1}\n',
      );
    } finally {
      write.mockRestore();
    }
  });

  it("handles one message per chunk, multiple lines, and split JSON", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('{"a":1}\n')).toEqual(['{"a":1}']);
    expect(decoder.push('{"b":2}\n{"c":')).toEqual(['{"b":2}']);
    expect(decoder.push("3}\n")).toEqual(['{"c":3}']);
    expect(decoder.finish()).toEqual([]);
  });

  it("keeps incomplete byte input before a following string chunk", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push(Uint8Array.from([0xe2]))).toEqual([]);
    expect(decoder.push('{"ok":true}\n')).toEqual(['�{"ok":true}']);
  });

  it("emits a valid handshake and responds to ping", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    createSidecarServer({ input, output, logger: silentLogger });

    const decoder = new NdjsonDecoder();
    const readyLine = output.read()?.toString() ?? "";
    const ready = parseSidecarReady(JSON.parse(readyLine) as unknown);
    expect(ready).toMatchObject({
      type: "ready",
      appVersion: VERSIONS.appVersion,
      protocolVersion: VERSIONS.protocolVersion,
    });

    input.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "r_1", method: "system.ping", params: {} })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const responseLines = decoder.push(output.read()?.toString() ?? "");
    expect(responseLines).toHaveLength(1);
    expect(parseResponseEnvelope(JSON.parse(responseLines[0] ?? "") as unknown)).toMatchObject({
      id: "r_1",
      ok: true,
      result: { ok: true, message: "pong" },
    });
  });

  it("waits for startup readiness before emitting the handshake", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    createSidecarServer({ input, output, logger: silentLogger, ready });
    expect(output.read()).toBeNull();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(parseSidecarReady(JSON.parse(output.read()?.toString() ?? "{}"))).toMatchObject({
      type: "ready",
    });
  });

  it("returns structured errors for malformed JSON and unknown methods", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    createSidecarServer({ input, output, logger: silentLogger });
    output.read();

    input.write("not-json\n");
    input.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "r_unknown", method: "future.method", params: {} })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const decoder = new NdjsonDecoder();
    const responses = decoder
      .push(output.read()?.toString() ?? "")
      .map((line) => parseResponseEnvelope(JSON.parse(line)));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(responses[1]).toMatchObject({
      id: "r_unknown",
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("routes compact Form discovery results through the generic RPC boundary", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    createSidecarServer({
      input,
      output,
      logger: silentLogger,
      handlers: {
        "forms.list": () => ({
          items: [{ formId: "form-1", title: "Survey", modifiedAt: "2026-08-28" }],
          nextCursor: "next-page",
        }),
      },
    });
    output.read();

    input.write(
      `${JSON.stringify({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_forms",
        method: "forms.list",
        params: {},
      })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const lines = new NdjsonDecoder().push(output.read()?.toString() ?? "");
    expect(lines).toHaveLength(1);
    expect(parseResponseEnvelope(JSON.parse(lines[0] ?? "") as unknown)).toMatchObject({
      id: "r_forms",
      ok: true,
      result: {
        items: [{ formId: "form-1", title: "Survey" }],
        nextCursor: "next-page",
      },
    });
  });

  it("shuts down through the protocol", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const onShutdown = vi.fn();
    createSidecarServer({ input, output, logger: silentLogger, onShutdown });
    output.read();

    input.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "r_shutdown", method: "system.shutdown", params: {} })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const lines = new NdjsonDecoder().push(output.read()?.toString() ?? "");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        v: VERSIONS.protocolVersion,
        type: "response",
        id: "r_shutdown",
        ok: true,
        result: { ok: true, message: "shutting_down" },
      },
    ]);
    expect(onShutdown).toHaveBeenCalledOnce();
  });

  it("stops processing after shutdown is requested and closes on input end", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const onShutdown = vi.fn();
    createSidecarServer({ input, output, logger: silentLogger, onShutdown });
    output.read();

    input.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "r_shutdown", method: "system.shutdown", params: {} })}\n` +
        `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "r_after", method: "system.ping", params: {} })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(new NdjsonDecoder().push(output.read()?.toString() ?? "")).toHaveLength(1);
    expect(onShutdown).toHaveBeenCalledOnce();

    const eofInput = new PassThrough();
    const eofOutput = new PassThrough();
    const onEof = vi.fn();
    createSidecarServer({
      input: eofInput,
      output: eofOutput,
      logger: silentLogger,
      onShutdown: onEof,
    });
    eofOutput.read();
    eofInput.end();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onEof).toHaveBeenCalledOnce();
  });
});
