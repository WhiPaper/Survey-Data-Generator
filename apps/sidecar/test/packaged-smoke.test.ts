import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSIONS } from "@survey-synth/contracts";

describe("compiled sidecar native dependency smoke", () => {
  it("starts from dist, opens encrypted SQLite, and answers RPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-synth-packaged-"));
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "main.js")], {
      cwd: process.cwd(),
      env: { ...process.env, SURVEY_SYNTH_APP_DATA_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const secret = Buffer.from("packaged-test-key").toString("base64");
    const lines: unknown[] = [];
    let buffered = "";
    let resolveHostRequest!: () => void;
    const hostRequestSeen = new Promise<void>((resolve) => {
      resolveHostRequest = resolve;
    });
    let resolveProjectList!: () => void;
    const projectListSeen = new Promise<void>((resolve) => {
      resolveProjectList = resolve;
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("compiled sidecar smoke timed out")), 10_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const chunks = buffered.split("\n");
        buffered = chunks.pop() ?? "";
        for (const line of chunks) {
          if (line.length === 0) continue;
          const message = JSON.parse(line) as { type?: string; id?: string; method?: string };
          lines.push(message);
          if (message.type === "host_request" && message.id !== undefined) {
            resolveHostRequest();
            const isGet = message.method === "host.secret.get";
            child.stdin.write(
              `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "host_response", id: message.id, ok: true, result: isGet ? { value: secret } : { ok: true } })}\n`,
            );
          }
          if (message.type === "ready") {
            child.stdin.write(
              `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "ping", method: "system.ping", params: {} })}\n`,
            );
          }
          if (message.type === "response" && message.id === "ping") {
            clearTimeout(timer);
            resolve(message);
          }
          if (message.type === "response" && message.id === "projects") resolveProjectList();
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        if (code !== 0) reject(new Error(`compiled sidecar exited with ${code}`));
      });
    });
    expect(result).toMatchObject({ type: "response", id: "ping", ok: true });
    expect(lines.some((message) => (message as { type?: string }).type === "ready")).toBe(true);
    const readyIndex = lines.findIndex(
      (message) => (message as { type?: string }).type === "ready",
    );
    const hostRequestIndex = lines.findIndex(
      (message) => (message as { type?: string }).type === "host_request",
    );
    expect(readyIndex).toBe(0);
    expect(hostRequestIndex).toBeGreaterThan(readyIndex);
    await hostRequestSeen;
    child.stdin.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "projects", method: "projects.list", params: {} })}\n`,
    );
    await projectListSeen;
    child.stdin.write(
      `${JSON.stringify({ v: VERSIONS.protocolVersion, type: "request", id: "shutdown", method: "system.shutdown", params: {} })}\n`,
    );
    const database = await readFile(join(directory, "projects.db"));
    expect(database.subarray(0, 15).toString("utf8")).not.toBe("SQLite format 3");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
});
