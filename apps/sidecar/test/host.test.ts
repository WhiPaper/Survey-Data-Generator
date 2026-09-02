import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  HostCapabilityError,
  RemoteGoogleTokenStore,
  RemoteSecureSecretStore,
  createHostCapabilityClient,
} from "../src/host.js";
import { NdjsonDecoder } from "../src/rpc/ndjson.js";
import { VERSIONS } from "@survey-synth/contracts";

const nextMessage = (output: PassThrough): Promise<Record<string, unknown>> =>
  new Promise((resolveMessage) => {
    const decoder = new NdjsonDecoder();
    const onData = (chunk: Buffer): void => {
      const lines = decoder.push(chunk);
      const line = lines[0];
      if (line === undefined) return;
      output.off("data", onData);
      resolveMessage(JSON.parse(line) as Record<string, unknown>);
    };
    output.on("data", onData);
  });

describe("sidecar host capability boundary", () => {
  it("round-trips secure secret requests without exposing values to the RPC client", async () => {
    const output = new PassThrough();
    const host = createHostCapabilityClient(output);
    const setPromise = host.call("host.secret.set", {
      key: "google:subject:refresh_token",
      value: Buffer.from("refresh-secret").toString("base64"),
    });
    const request = await nextMessage(output);
    expect(request).toMatchObject({
      method: "host.secret.set",
      params: {
        key: "google:subject:refresh_token",
        value: Buffer.from("refresh-secret").toString("base64"),
      },
      type: "host_request",
    });
    host.handleMessage({
      v: VERSIONS.protocolVersion,
      type: "host_response",
      id: request.id,
      ok: true,
      result: { ok: true },
    });
    await expect(setPromise).resolves.toEqual({ ok: true });

    const secureStore = new RemoteSecureSecretStore(host);
    const getPromise = secureStore.get("google:subject:refresh_token");
    const getRequest = await nextMessage(output);
    host.handleMessage({
      v: VERSIONS.protocolVersion,
      type: "host_response",
      id: getRequest.id,
      ok: true,
      result: { value: Buffer.from("refresh-secret").toString("base64") },
    });
    await expect(getPromise).resolves.toEqual(new TextEncoder().encode("refresh-secret"));
    output.end();
  });

  it("namespaces Google refresh tokens and maps host failures", async () => {
    const output = new PassThrough();
    const host = createHostCapabilityClient(output);
    const tokenStore = new RemoteGoogleTokenStore(new RemoteSecureSecretStore(host));
    const setPromise = tokenStore.setRefreshToken("subject-1", "refresh-1");
    const request = await nextMessage(output);
    expect(request).toMatchObject({
      method: "host.secret.set",
      params: { key: "google:subject-1:refresh_token" },
    });
    host.handleMessage({
      v: VERSIONS.protocolVersion,
      type: "host_response",
      id: request.id,
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Secure secret store is unavailable",
        recoverable: true,
      },
    });
    await expect(setPromise).rejects.toBeInstanceOf(HostCapabilityError);
    output.end();
  });
});
