import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@survey-synth/contracts";

import { handleBackendCall } from "../electron/main/backend";

const serialize = (request: ReturnType<typeof createRequest>) => JSON.stringify(request);

describe("Electron v2 backend shell", () => {
  it("answers system.ping", async () => {
    await expect(
      handleBackendCall(serialize(createRequest("test_ping", "system.ping", {}))),
    ).resolves.toEqual({ ok: true, message: "pong" });
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

  it("routes ValueGroup creation to the ValueGroup service", async () => {
    const create = vi.fn(async (input: { projectId: string; questionId: string; name: string; members: string[] }) => ({
      id: "group-1",
      ...input,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    }));
    const valueGroups = {
      list: async (_projectId: string) => [],
      values: async (_projectId: string, _questionId: string) => [],
      create,
      delete: async (_valueGroupId: string) => undefined,
    };

    await expect(
      handleBackendCall(
        serialize(
          createRequest("test_group", "valueGroups.create", {
            projectId: "project-1",
            questionId: "q-choice",
            name: "행사 관심",
            members: ["festival"],
          }),
        ),
        { valueGroups },
      ),
    ).resolves.toMatchObject({ id: "group-1", members: ["festival"] });
    expect(create).toHaveBeenCalledWith({
      projectId: "project-1",
      questionId: "q-choice",
      name: "행사 관심",
      members: ["festival"],
    });
  });
});
