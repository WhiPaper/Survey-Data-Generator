import { describe, expect, it, vi } from "vitest";

import {
  BackendClientError,
  addAccount,
  callBackend,
  getAccounts,
  getSession,
  importForm,
  listForms,
  login,
  logout,
  pingBackend,
  refreshSource,
  resolveMigrationIssue,
  revokeAccess,
  switchAccount,
} from "../src/api/backend";
import {
  VERSIONS,
  parseRpcRequest,
  type FormId,
  type GoogleAccountId,
} from "@survey-synth/contracts";

describe("typed desktop backend client", () => {
  it("sends system.ping through the generic backend command and parses its response", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = JSON.parse(String(args?.request)) as unknown;
      expect(parseRpcRequest(request)).toMatchObject({ method: "system.ping", params: {} });
      expect((request as { v: number }).v).toBe(VERSIONS.protocolVersion);
      return { ok: true, message: "pong" };
    });

    await expect(pingBackend({ invoke })).resolves.toEqual({ ok: true, message: "pong" });
    expect(invoke).toHaveBeenCalledWith(
      "backend_call",
      expect.objectContaining({ request: expect.any(String) }),
    );
  });

  it("preserves structured backend failures", async () => {
    const invoke = vi.fn(async () => {
      throw {
        code: "BACKEND_UNAVAILABLE",
        message: "Sidecar exited",
        recoverable: true,
      };
    });

    await expect(pingBackend({ invoke })).rejects.toEqual(
      new BackendClientError({
        code: "BACKEND_UNAVAILABLE",
        message: "Sidecar exited",
        recoverable: true,
      }),
    );
  });

  it("surfaces invalid request parameters as a structured validation error", async () => {
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

  it("exposes frontend-safe session and account actions through typed RPC", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      switch (request.method) {
        case "session.get":
          return { account: { id: "account-1", email: "user@example.com" } };
        case "auth.login":
        case "auth.addAccount":
        case "auth.switchAccount":
          return { account: { id: "account-1", email: "user@example.com" } };
        case "auth.accounts":
          return [{ id: "account-1", email: "user@example.com" }];
        case "auth.logout":
        case "auth.revokeAccess":
          return { ok: true };
        default:
          throw new Error(`Unexpected method ${request.method}`);
      }
    });

    await expect(getSession({ invoke })).resolves.toEqual({
      account: { id: "account-1", email: "user@example.com" },
    });
    await expect(login({ invoke })).resolves.toMatchObject({
      account: { email: "user@example.com" },
    });
    await expect(getAccounts({ invoke })).resolves.toHaveLength(1);
    await expect(addAccount({ invoke })).resolves.toBeTruthy();
    await expect(switchAccount("account-1" as GoogleAccountId, { invoke })).resolves.toBeTruthy();
    await expect(logout({ invoke })).resolves.toEqual({ ok: true });
    await expect(revokeAccess("account-1" as GoogleAccountId, { invoke })).resolves.toEqual({
      ok: true,
    });
    expect(invoke).toHaveBeenCalledTimes(7);
  });

  it("exposes compact Form discovery and import RPCs", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      if (request.method === "forms.list") {
        expect(request.params).toEqual({ query: "Customer" });
        return {
          items: [{ formId: "form-1", title: "Customer survey", modifiedAt: "2026-08-28" }],
          nextCursor: "page-2",
        };
      }
      if (request.method === "forms.import") {
        expect(request.params).toMatchObject({ formId: "form-1" });
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

    await expect(listForms({ query: "Customer" }, { invoke })).resolves.toMatchObject({
      items: [{ formId: "form-1", title: "Customer survey" }],
      nextCursor: "page-2",
    });
    await expect(importForm("form-1" as FormId, { invoke })).resolves.toMatchObject({
      projectId: "project-1",
      sourceRevisionId: "revision-1",
      responseCount: 2,
    });
    await expect(importForm("form-1" as FormId, "operation-1", { invoke })).resolves.toMatchObject({
      projectId: "project-1",
      sourceRevisionId: "revision-1",
      responseCount: 2,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("passes expectedTargetRevision on refreshSource and resolution on resolveMigrationIssue", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      if (request.method === "projects.refreshSource") {
        expect(request.params).toMatchObject({
          projectId: "proj-1",
          expectedTargetRevision: 3,
        });
        return {
          status: "no_change",
          sourceRevisionId: "rev-1",
          sourceResponseCount: 10,
        };
      }
      if (request.method === "projects.resolveMigrationIssue") {
        expect(request.params).toMatchObject({
          projectId: "proj-1",
          issueId: "iss-1",
          resolution: "remove_target",
        });
        return { ok: true };
      }
      throw new Error(`Unexpected method ${request.method}`);
    });

    await expect(refreshSource("proj-1", 3, undefined, { invoke })).resolves.toMatchObject({
      status: "no_change",
    });
    await expect(
      resolveMigrationIssue("proj-1", "iss-1", "remove_target", { invoke }),
    ).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
