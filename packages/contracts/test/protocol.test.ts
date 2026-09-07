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
  });

  it("accepts the four public target kinds and all depth-1 subjects", () => {
    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "synth-targets",
        method: "synthesis.start",
        params: {
          projectId: "project-1",
          finalCount: 120,
          sourceScope: { kind: "all" },
          targets: [
            { id: "t-mean", kind: "mean", questionId: "q-score", value: 4.3 },
            {
              id: "t-share-group",
              kind: "share",
              subject: { kind: "value_group", valueGroupId: "group-1" },
              value: 0.35,
            },
            {
              id: "t-share-option",
              kind: "share",
              subject: { kind: "option", questionId: "q-region", optionKey: "seoul" },
              value: 0.3,
            },
            {
              id: "t-share-checkbox",
              kind: "share",
              subject: {
                kind: "checkbox_option",
                questionId: "q-checkbox",
                optionKey: "music",
              },
              value: 0.6,
            },
            {
              id: "t-count",
              kind: "count",
              subject: { kind: "option", questionId: "q-region", optionKey: "jeju" },
              value: 10,
            },
            {
              id: "t-conditional",
              kind: "conditional_share",
              population: { kind: "value_group", valueGroupId: "group-1" },
              questionId: "q-checkbox",
              optionKey: "bus",
              value: 0.6,
            },
          ],
          seed: 42,
        },
      }),
    ).toMatchObject({ method: "synthesis.start" });
  });

  it("requires stable unique TargetIds", () => {
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "duplicate-target-id",
        method: "synthesis.start",
        params: {
          projectId: "project-1",
          finalCount: 120,
          targets: [
            { id: "same", kind: "mean", questionId: "q-score", value: 4.3 },
            {
              id: "same",
              kind: "share",
              subject: { kind: "value_group", valueGroupId: "group-1" },
              value: 0.5,
            },
          ],
          seed: 42,
        },
      }),
    ).toThrow(/TargetId must be unique/);
  });

  it("validates target ranges at the public boundary", () => {
    expect(() =>
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "bad-share",
        method: "synthesis.start",
        params: {
          projectId: "project-1",
          finalCount: 120,
          targets: [
            {
              id: "bad",
              kind: "share",
              subject: { kind: "option", questionId: "q", optionKey: "a" },
              value: 1.1,
            },
          ],
          seed: 42,
        },
      }),
    ).toThrow();
  });

  it("uses target-aware outcomes for EditPlan comparison", () => {
    const appendOnlyOutcome = {
      targets: [
        {
          targetId: "t-mean",
          kind: "mean",
          requested: 4.5,
          achieved: 4,
          absoluteError: 0.5,
          exact: false,
        },
      ],
    };
    const replacementOutcome = {
      targets: [
        {
          targetId: "t-mean",
          kind: "mean",
          requested: 4.5,
          achieved: 4.5,
          absoluteError: 0,
          exact: true,
        },
      ],
    };
    expect(
      parseRpcResult("synthesis.start", {
        status: "approval_required",
        planId: "plan-1",
        editPlan: {
          status: "available",
          replacementCount: 1,
          proposedReplacements: [
            {
              sourceResponseId: "source-1",
              replacementResponseId: "replacement:42:1",
            },
          ],
          appendOnlyOutcome,
          replacementOutcome,
        },
      }),
    ).toMatchObject({ status: "approval_required", planId: "plan-1" });
  });

  it("uses the same target outcome shape for synthesis success", () => {
    expect(
      parseRpcResult("synthesis.start", {
        status: "success",
        runId: "run-1",
        syntheticResponseCount: 40,
        finalResponseCount: 120,
        outcome: {
          targets: [
            {
              targetId: "t-mean",
              kind: "mean",
              requested: 4.3,
              achieved: 4.298,
              absoluteError: 0.002,
              exact: false,
            },
          ],
        },
      }),
    ).toMatchObject({ status: "success", outcome: { targets: [{ targetId: "t-mean" }] } });
  });

  it("parses explicit Project source refresh requests and review diagnostics", () => {
    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "refresh-source",
        method: "projects.refreshSource",
        params: { projectId: "project-1", operationId: "refresh-1" },
      }),
    ).toMatchObject({ method: "projects.refreshSource" });

    expect(
      parseRpcRequest({
        v: VERSIONS.protocolVersion,
        type: "request",
        id: "review-source",
        method: "projects.sourceReview",
        params: { projectId: "project-1" },
      }),
    ).toMatchObject({ method: "projects.sourceReview" });

    expect(
      parseRpcResult("projects.sourceReview", {
        projectId: "project-1",
        sourceRevisionId: "revision-2",
        invalidValueGroupIds: ["group-1"],
        targetIssues: [
          {
            targetIds: ["target-1"],
            code: "invalid_subject",
            message: "Target subject is not valid for this Form",
          },
        ],
      }),
    ).toMatchObject({
      projectId: "project-1",
      sourceRevisionId: "revision-2",
      invalidValueGroupIds: ["group-1"],
      targetIssues: [{ code: "invalid_subject" }],
    });

    expect(
      parseRpcResult("projects.refreshSource", {
        project: {
          id: "project-1",
          googleAccountId: "account-1",
          googleFormId: "form-1",
          name: "Survey",
          currentSourceRevisionId: "revision-2",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
          responseCount: 10,
          questionCount: 3,
          form: { formId: "form-1", questions: [] },
          responseTimestampRange: null,
        },
        previousSourceRevisionId: "revision-1",
        sourceRevisionId: "revision-2",
        invalidValueGroupIds: ["group-1"],
        targetIssues: [
          {
            targetIds: ["target-1"],
            code: "invalid_subject",
            message: "Target subject is not valid for this Form",
          },
        ],
      }),
    ).toMatchObject({
      sourceRevisionId: "revision-2",
      invalidValueGroupIds: ["group-1"],
      targetIssues: [{ code: "invalid_subject" }],
    });
  });

  it("accepts authoritative Question Explorer profile metrics and Run summaries", () => {
    expect(
      parseRpcResult("targets.profile", {
        projectId: "project-1",
        sourceRevisionId: "revision-1",
        sourceScope: { kind: "all" },
        responseCount: 2,
        responseSetHash: "hash",
        metrics: [
          {
            kind: "ordinal_distribution",
            questionId: "q-score",
            denominatorCount: 2,
            values: [
              { value: 1, count: 0, share: 0 },
              { value: 2, count: 1, share: 0.5 },
            ],
          },
          {
            kind: "conditional_share",
            population: { kind: "value_group", valueGroupId: "group-1" },
            questionId: "q-checkbox",
            optionKey: "music",
            count: 1,
            denominatorCount: 2,
            share: 0.5,
          },
        ],
      }),
    ).toMatchObject({ metrics: [{ kind: "ordinal_distribution" }, { kind: "conditional_share" }] });

    expect(
      parseRpcResult("runs.list", [
        {
          runId: "run-1",
          projectId: "project-1",
          sourceRevisionId: "revision-1",
          createdAt: "2026-09-07T00:00:00.000Z",
          finalResponseCount: 120,
        },
      ]),
    ).toMatchObject([{ runId: "run-1", finalResponseCount: 120 }]);
  });

  it("accepts structured target issues", () => {
    expect(
      parseRpcResult("synthesis.start", {
        status: "infeasible",
        issues: [
          {
            targetIds: ["t-1", "t-2"],
            code: "target_conflict",
            message: "Targets cannot be satisfied together",
          },
        ],
      }),
    ).toMatchObject({ status: "infeasible" });
  });

  it("validates frozen target subjects and immutable EditPlan snapshots", () => {
    const outcome = {
      targets: [
        {
          targetId: "t-mean",
          kind: "mean",
          requested: 4.3,
          achieved: 4.3,
          absoluteError: 0,
          exact: true,
        },
      ],
    };
    expect(
      parseRpcResult("runs.get", {
        runId: "run-1",
        projectId: "project-1",
        sourceRevisionId: "revision-1",
        targetSnapshot: {
          finalCount: 120,
          sourceScope: { kind: "all" },
          targets: [
            { id: "t-mean", kind: "mean", questionId: "q-score", value: 4.3 },
            {
              id: "t-share",
              kind: "share",
              value: 0.35,
              subject: {
                kind: "value_group",
                valueGroup: {
                  id: "group-1",
                  questionId: "q-choice",
                  name: "행사 관심",
                  members: ["festival", "performance"],
                },
              },
            },
            {
              id: "t-conditional",
              kind: "conditional_share",
              value: 0.6,
              questionId: "q-checkbox",
              optionKey: "music",
              population: {
                kind: "value_group",
                valueGroup: {
                  id: "group-1",
                  questionId: "q-choice",
                  name: "행사 관심",
                  members: ["festival", "performance"],
                },
              },
            },
          ],
          editPlan: {
            status: "available",
            replacementCount: 1,
            proposedReplacements: [
              {
                sourceResponseId: "source-1",
                replacementResponseId: "replacement:42:1",
              },
            ],
            appendOnlyOutcome: {
              targets: [
                {
                  targetId: "t-mean",
                  kind: "mean",
                  requested: 4.3,
                  achieved: 4.2,
                  absoluteError: 0.1,
                  exact: false,
                },
              ],
            },
            replacementOutcome: outcome,
          },
        },
        outcome,
        validation: {},
        finalResponseCount: 120,
        appVersion: VERSIONS.appVersion,
        engineVersion: VERSIONS.engineVersion,
      }),
    ).toMatchObject({
      runId: "run-1",
      finalResponseCount: 120,
      outcome: { targets: [{ targetId: "t-mean" }] },
      targetSnapshot: { editPlan: { replacementCount: 1 } },
    });
  });
});
