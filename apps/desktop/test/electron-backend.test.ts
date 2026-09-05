import { describe, expect, it, vi } from "vitest";
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

  it("routes project deletion to the project service", async () => {
    const remove = vi.fn(async (_projectId: string): Promise<void> => undefined);
    const projects = {
      list: async () => [],
      get: async (_projectId: string) => null,
      delete: remove,
    };

    await expect(
      handleBackendCall(
        serialize(createRequest("test_project_delete", "projects.delete", { projectId: "project-1" })),
        { projects },
      ),
    ).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("project-1");
  });
});
