import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  VERSIONS,
  parseResponseEnvelope,
  parseSidecarReady,
  type ResponseEnvelope,
  type SidecarReady,
} from "@survey-synth/contracts";
import { NdjsonDecoder } from "@survey-synth/sidecar/rpc";

const sidecarPath = resolve(import.meta.dirname, "../../apps/sidecar/dist/main.js");

const waitForExit = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code));
  });

const launchSidecar = () => {
  const child = spawn(process.execPath, [sidecarPath], { stdio: ["pipe", "pipe", "pipe"] });
  const decoder = new NdjsonDecoder();
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of decoder.push(chunk)) {
      const message = JSON.parse(line) as unknown;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    }
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const nextMessage = (): Promise<unknown> => {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolveMessage) => waiters.push(resolveMessage));
  };
  return { child, nextMessage, stderr };
};

describe("packaged-shape sidecar process boundary", () => {
  it("keeps stdout protocol-only, handles split input, and shuts down cleanly", async () => {
    const sidecar = launchSidecar();
    try {
      const ready = parseSidecarReady(await sidecar.nextMessage());
      expect(ready).toMatchObject<Partial<SidecarReady>>({
        type: "ready",
        appVersion: VERSIONS.appVersion,
        protocolVersion: VERSIONS.protocolVersion,
      });

      const request = JSON.stringify({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "integration_ping",
        method: "system.ping",
        params: {},
      });
      const splitAt = Math.floor(request.length / 2);
      sidecar.child.stdin.write(request.slice(0, splitAt));
      sidecar.child.stdin.write(`${request.slice(splitAt)}\n`);
      const response = parseResponseEnvelope(await sidecar.nextMessage());
      expect(response).toMatchObject<ResponseEnvelope>({
        id: "integration_ping",
        type: "response",
        ok: true,
        result: { ok: true, message: "pong" },
      });

      sidecar.child.stdin.write(
        `${JSON.stringify({
          v: VERSIONS.protocolVersion,
          type: "request",
          id: "integration_session",
          method: "session.get",
          params: {},
        })}\n`,
      );
      const session = parseResponseEnvelope(await sidecar.nextMessage());
      expect(session).toMatchObject({ id: "integration_session", ok: true, result: null });

      sidecar.child.stdin.write(
        `${JSON.stringify({
          v: VERSIONS.protocolVersion,
          type: "request",
          id: "integration_shutdown",
          method: "system.shutdown",
          params: {},
        })}\n`,
      );
      const shutdown = parseResponseEnvelope(await sidecar.nextMessage());
      expect(shutdown).toMatchObject({ id: "integration_shutdown", ok: true });
      await expect(waitForExit(sidecar.child)).resolves.toBe(0);
      expect(Buffer.concat(sidecar.stderr).toString()).toContain("sidecar_ready");
    } finally {
      if (sidecar.child.exitCode === null) sidecar.child.kill();
    }
  });
});
