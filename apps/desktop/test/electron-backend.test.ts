import { describe, expect, it } from "vitest";
import { createRequest } from "@survey-synth/contracts";

import { handleBackendCall } from "../electron/main/backend";

const serialize = (request: ReturnType<typeof createRequest>) => JSON.stringify(request);

describe("Electron v2 backend shell", () => {
  it("answers system.ping", async () => {
    await expect(handleBackendCall(serialize(createRequest("test_ping", "system.ping", {})))).resolves.toEqual({
      ok: true,
      message: "pong",
    });
  });

  it("starts without an authenticated session", async () => {
    await expect(
      handleBackendCall(serialize(createRequest("test_session", "session.get", {}))),
    ).resolves.toBeNull();
  });

  it("rejects auth calls until the Electron auth service is initialized", async () => {
    await expect(
      handleBackendCall(serialize(createRequest("test_login", "auth.login", {}))),
    ).rejects.toThrow("Google authentication is not initialized");
  });
});
