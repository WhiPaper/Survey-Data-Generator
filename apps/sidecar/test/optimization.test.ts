import { describe, expect, it } from "vitest";
import {
  allocateTemplateWeights,
  compileTargets,
  compileTemplateWeights,
} from "@survey-synth/synthesis-core";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import { HighsOptimizationBackend } from "../src/optimization/highs-backend.js";

const compiled = (source: readonly NormalizedResponse[], targets: ProjectTargets) =>
  compileTargets({ questions: [] } as FormSnapshot, source, targets);

describe("HiGHS optimization backend", () => {
  it("solves representative LP and MIP IR without leaking solver types into core", async () => {
    const backend = new HighsOptimizationBackend();
    const lp = await backend.solveLinear({
      variables: [
        { id: "x", lowerBound: 0 },
        { id: "y", lowerBound: 0 },
      ],
      constraints: [{ id: "sum", coefficients: { x: 1, y: 1 }, relation: "=", rightHandSide: 3 }],
    });
    expect(lp.status).toBe("optimal");
    expect((lp.values.x ?? 0) + (lp.values.y ?? 0)).toBeCloseTo(3, 8);
    const mip = await backend.solveMixedInteger({
      variables: [{ id: "x", lowerBound: 0, upperBound: 10, integer: true }],
      constraints: [{ id: "integer", coefficients: { x: 1 }, relation: "=", rightHandSide: 3 }],
    });
    expect(mip).toMatchObject({ status: "optimal", values: { x: 3 } });
  });

  it("allocates exact final count and range targets from immutable source contribution", async () => {
    const source: NormalizedResponse[] = [
      {
        responseId: "female" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          gender: {
            state: "answered",
            value: { kind: "single_choice", optionKey: "female" as never, label: "Female" },
          },
        },
      },
      {
        responseId: "male" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          gender: {
            state: "answered",
            value: { kind: "single_choice", optionKey: "male" as never, label: "Male" },
          },
        },
      },
    ];
    const targets: ProjectTargets = {
      targetResponseCount: 4,
      questionTargets: [
        {
          kind: "option",
          questionId: "gender" as never,
          optionKey: "female" as never,
          target: { kind: "count_range", min: 3, max: 3 },
        },
      ],
    };
    const plan = compileTemplateWeights(source, compiled(source, targets));
    const solution = await new HighsOptimizationBackend().solveMixedInteger(plan.problem);
    expect(solution.status).toBe("optimal");
    expect(allocateTemplateWeights(plan, solution.values)).toEqual([0, 0]);
  });

  it("keeps no-target allocation near source-template proportions", async () => {
    const source: NormalizedResponse[] = [
      {
        responseId: "one" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      },
      {
        responseId: "two" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      },
    ];
    const targets = { targetResponseCount: 7, questionTargets: [] };
    const plan = compileTemplateWeights(source, compiled(source, targets));
    const solution = await new HighsOptimizationBackend().solveMixedInteger(plan.problem);
    const allocated = allocateTemplateWeights(plan, solution.values);
    expect(solution.status).toBe("optimal");
    expect(allocated).toHaveLength(5);
    expect(allocated?.filter((index) => index === 0).length).toBeGreaterThanOrEqual(2);
    expect(allocated?.filter((index) => index === 1).length).toBeGreaterThanOrEqual(2);
  });

  it("compiles an unanswered ratio with answered indicators, not final-row count", () => {
    const source: NormalizedResponse[] = [
      {
        responseId: "female" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          gender: {
            state: "answered",
            value: { kind: "single_choice", optionKey: "female" as never, label: "Female" },
          },
        },
      },
      {
        responseId: "skipped" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: { gender: { state: "skipped" } },
      },
    ];
    const plan = compileTemplateWeights(
      source,
      compiled(source, {
        targetResponseCount: 4,
        questionTargets: [
          {
            kind: "option",
            questionId: "gender" as never,
            optionKey: "female" as never,
            target: { kind: "ratio", value: 0.5 },
          },
        ],
      }),
    );
    expect(
      plan.problem.constraints.find((constraint) => constraint.id === "option_gender_female"),
    ).toMatchObject({ coefficients: { template_0: 0.5, template_1: 0 }, rightHandSide: -0.5 });
  });
});
