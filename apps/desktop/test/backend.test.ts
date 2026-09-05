import { describe, expect, it, vi } from "vitest";

import {
  BackendClientError,
  addAccount,
  callBackend,
  createValueGroup,
  getAccounts,
  getSession,
  importForm,
  listForms,
  listValueGroups,
  login,
  logout,
  pingBackend,
  startSynthesis,
  switchAccount,
} from "../src/api/backend";
import {
  VERSIONS,
  parseRpcRequest,
  type FormId,
  type GoogleAccountId,
} from "@survey-synth/contracts";

describe("typed v2 desktop backend client", () => {
  it("sends system.ping through the generic backend command", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = JSON.parse(String(args?.request)) as unknown;
      expect(parseRpcRequest(request)).toMatchObject({ method: "system.ping", params: {} });
      expect((request as { v: number }).v).toBe(VERSIONS.protocolVersion);
      return { ok: true, message: "pong" };
    });
    await expect(pingBackend({ invoke })).resolves.toEqual({ ok: true, message: "pong" });
  });

  it("preserves structured backend failures", async () => {
    const invoke = vi.fn(async () => {
      throw { code: "BACKEND_UNAVAILABLE", message: "Engine unavailable", recoverable: true };
    });
    await expect(pingBackend({ invoke })).rejects.toEqual(
      new BackendClientError({
        code: "BACKEND_UNAVAILABLE",
        message: "Engine unavailable",
        recoverable: true,
      }),
    );
  });

  it("rejects invalid request parameters before invoking Electron", async () => {
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

  it("exposes renderer-safe session actions", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      switch (request.method) {
        case "session.get":
        case "auth.login":
        case "auth.addAccount":
        case "auth.switchAccount":
          return { account: { id: "account-1", email: "user@example.com" } };
        case "auth.accounts":
          return [{ id: "account-1", email: "user@example.com" }];
        case "auth.logout":
          return { ok: true };
        default:
          throw new Error(`Unexpected method ${request.method}`);
      }
    });

    await expect(getSession({ invoke })).resolves.toBeTruthy();
    await expect(login({ invoke })).resolves.toBeTruthy();
    await expect(getAccounts({ invoke })).resolves.toHaveLength(1);
    await expect(addAccount({ invoke })).resolves.toBeTruthy();
    await expect(switchAccount("account-1" as GoogleAccountId, { invoke })).resolves.toBeTruthy();
    await expect(logout({ invoke })).resolves.toEqual({ ok: true });
  });

  it("exposes compact Form discovery and import RPCs", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      if (request.method === "forms.list") {
        return { items: [{ formId: "form-1", title: "Customer survey" }] };
      }
      if (request.method === "forms.import") {
        return {
          projectId: "project-1",
          sourceRevisionId: "revision-1",
          formId: "form-1",
          title: "Customer survey",
          responseCount: 2,
          questionCount: 3,
        };
      }
      throw new Error(`Unexpected method ${request.method}`);
    });

    await expect(listForms({}, { invoke })).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(importForm("form-1" as FormId, { invoke })).resolves.toMatchObject({
      projectId: "project-1",
      sourceRevisionId: "revision-1",
    });
  });

  it("exposes ValueGroup and M6 synthesis RPCs", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      if (request.method === "valueGroups.list") return [];
      if (request.method === "valueGroups.create") {
        return {
          id: "group-1",
          projectId: "project-1",
          questionId: "q-choice",
          name: "행사 관심",
          members: ["festival"],
          createdAt: "2026-09-06T00:00:00.000Z",
          updatedAt: "2026-09-06T00:00:00.000Z",
        };
      }
      if (request.method === "synthesis.start") {
        expect(request.params).toMatchObject({
          finalCount: 120,
          sourceScope: { kind: "all" },
          targets: expect.arrayContaining([
            {
              kind: "conditional_share",
              valueGroupId: "group-1",
              questionId: "q-checkbox",
              optionKey: "music",
              value: 0.6,
            },
          ]),
        });
        return {
          status: "success",
          runId: "run-1",
          syntheticResponseCount: 40,
          finalResponseCount: 120,
        };
      }
      throw new Error(`Unexpected method ${request.method}`);
    });

    await expect(listValueGroups("project-1", { invoke })).resolves.toEqual([]);
    await expect(
      createValueGroup(
        {
          projectId: "project-1",
          questionId: "q-choice",
          name: "행사 관심",
          members: ["festival"],
        },
        { invoke },
      ),
    ).resolves.toMatchObject({ id: "group-1" });
    await expect(
      startSynthesis(
        {
          projectId: "project-1",
          finalCount: 120,
          sourceScope: { kind: "all" },
          targets: [
            { kind: "mean", questionId: "q-score", value: 4.3 },
            { kind: "share", valueGroupId: "group-1", value: 0.35 },
            {
              kind: "conditional_share",
              valueGroupId: "group-1",
              questionId: "q-checkbox",
              optionKey: "music",
              value: 0.6,
            },
          ],
          seed: 42,
        },
        { invoke },
      ),
    ).resolves.toMatchObject({ status: "success", runId: "run-1" });
  });
});
