import { describe, expect, it } from "vitest";

import {
  BackendErrorSchema,
  VERSIONS,
  createPingRequest,
  parseRpcRequest,
  parseRpcResult,
} from "../src/index.js";

describe("v2 RPC contracts", () => {
  it("parses system.ping and rejects unknown legacy methods", () => {
    expect(parseRpcRequest(createPingRequest("r_1"))).toEqual({
      v: VERSIONS.protocolVersion,
      type: "request",
      id: "r_1",
      method: "system.ping",
      params: {},
    });
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "legacy",
        method: "system.shutdown",
        params: {},
      }),
    ).toThrow();
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "legacy-ai",
        method: "ai.status",
        params: {},
      }),
    ).toThrow();
  });

  it("rejects invalid method parameters", () => {
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_2",
        method: "system.ping",
        params: { unexpected: true },
      }),
    ).toThrow();
  });

  it("accepts only structured backend errors", () => {
    expect(
      BackendErrorSchema.parse({
        code: "BACKEND_UNAVAILABLE",
        message: "Engine unavailable",
        recoverable: true,
      }),
    ).toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    expect(() => BackendErrorSchema.parse({ message: "raw string error" })).toThrow();
  });

  it("keeps session results renderer-safe", () => {
    expect(
      parseRpcResult("session.get", {
        account: {
          id: "account-1",
          email: "user@example.com",
          avatarUrl: "https://lh3.googleusercontent.com/avatar",
        },
      }),
    ).toEqual({
      account: {
        id: "account-1",
        email: "user@example.com",
        avatarUrl: "https://lh3.googleusercontent.com/avatar",
      },
    });
    expect(() =>
      parseRpcResult("session.get", {
        account: { id: "account-1", email: "user@example.com", accessToken: "secret" },
      }),
    ).toThrow();
  });

  it("validates compact Form discovery and import contracts", () => {
    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "r_forms",
        method: "forms.list",
        params: { query: "Customer", cursor: "page-2" },
      }),
    ).toMatchObject({ method: "forms.list" });
    expect(
      parseRpcResult("forms.import", {
        projectId: "project-1",
        sourceRevisionId: "revision-1",
        formId: "form-1",
        title: "Customer survey",
        responseCount: 2,
        questionCount: 5,
      }),
    ).toMatchObject({ projectId: "project-1", sourceRevisionId: "revision-1" });
    expect(() =>
      parseRpcResult("forms.import", {
        importId: "legacy-import-id",
        formId: "form-1",
        title: "Customer survey",
        responseCount: 2,
        questionCount: 5,
      }),
    ).toThrow();
  });

  it("validates ValueGroup, mean, share, and conditional share synthesis contracts", () => {
    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "group-create",
        method: "valueGroups.create",
        params: {
          projectId: "project-1",
          questionId: "q-choice",
          name: "행사 관심",
          members: ["festival", "performance"],
        },
      }),
    ).toMatchObject({ method: "valueGroups.create" });

    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "synth-m6",
        method: "synthesis.start",
        params: {
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
      }),
    ).toMatchObject({ method: "synthesis.start" });

    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "bad-conditional-share",
        method: "synthesis.start",
        params: {
          projectId: "project-1",
          finalCount: 120,
          targets: [
            { kind: "mean", questionId: "q-score", value: 4.3 },
            {
              kind: "conditional_share",
              valueGroupId: "group-1",
              questionId: "q-checkbox",
              optionKey: "music",
              value: -0.1,
            },
          ],
          seed: 42,
        },
      }),
    ).toThrow();
  });

  it("validates frozen ValueGroup snapshots in Run results", () => {
    expect(
      parseRpcResult("runs.get", {
        runId: "run-1",
        projectId: "project-1",
        sourceRevisionId: "revision-1",
        targetSnapshot: {
          finalCount: 120,
          sourceScope: { kind: "all" },
          targets: [
            { kind: "mean", questionId: "q-score", value: 4.3 },
            {
              kind: "share",
              value: 0.35,
              valueGroup: {
                id: "group-1",
                questionId: "q-choice",
                name: "행사 관심",
                members: ["festival", "performance"],
              },
            },
            {
              kind: "conditional_share",
              value: 0.6,
              questionId: "q-checkbox",
              optionKey: "music",
              valueGroup: {
                id: "group-1",
                questionId: "q-choice",
                name: "행사 관심",
                members: ["festival", "performance"],
              },
            },
          ],
        },
        validation: {},
        finalResponseCount: 120,
      }),
    ).toMatchObject({ runId: "run-1", finalResponseCount: 120 });
  });
});
