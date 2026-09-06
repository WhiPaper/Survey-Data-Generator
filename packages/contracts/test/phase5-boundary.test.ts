import { describe, expect, it } from "vitest";

import { VERSIONS, parseRpcRequest } from "../src/index.js";

const synthesisRequest = (target: Record<string, unknown>) => ({
  v: VERSIONS.protocolVersion,
  type: "request" as const,
  id: "phase5-boundary",
  method: "synthesis.start" as const,
  params: {
    projectId: "project-1",
    finalCount: 100,
    sourceScope: { kind: "all" },
    targets: [target],
    seed: 42,
  },
});

describe("Phase 5 public-contract boundary", () => {
  it.each([
    [
      "generic formula targets",
      { id: "t-formula", kind: "formula", expression: "q1 + q2", value: 1 },
    ],
    [
      "arbitrary boolean populations",
      {
        id: "t-boolean",
        kind: "conditional_share",
        population: {
          kind: "and",
          conditions: [
            { questionId: "q1", optionKey: "a" },
            { questionId: "q2", optionKey: "b" },
          ],
        },
        questionId: "q3",
        optionKey: "c",
        value: 0.5,
      },
    ],
    [
      "custom denominators",
      {
        id: "t-denominator",
        kind: "share",
        subject: { kind: "option", questionId: "q1", optionKey: "a" },
        denominator: { questionId: "q2", optionKey: "b" },
        value: 0.5,
      },
    ],
    [
      "user-defined target weights",
      {
        id: "t-weight",
        kind: "share",
        subject: { kind: "option", questionId: "q1", optionKey: "a" },
        value: 0.5,
        weight: 10,
      },
    ],
    [
      "metric plugins",
      {
        id: "t-plugin",
        kind: "metric_plugin",
        plugin: "example.metric",
        config: {},
        value: 1,
      },
    ],
    [
      "target scripting",
      {
        id: "t-script",
        kind: "script",
        source: "return row.q1 === 'a'",
        value: 0.5,
      },
    ],
  ])("rejects %s", (_name, target) => {
    expect(() => parseRpcRequest(synthesisRequest(target))).toThrow();
  });

  it("keeps conditional_share at ValueGroup population + checkbox option depth", () => {
    expect(
      parseRpcRequest(
        synthesisRequest({
          id: "t-conditional",
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: "group-1" },
          questionId: "q-checkbox",
          optionKey: "bus",
          value: 0.6,
        }),
      ),
    ).toMatchObject({ method: "synthesis.start" });
  });
});
