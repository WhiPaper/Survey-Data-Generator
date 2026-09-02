import { describe, expect, it } from "vitest";
import {
  allocateTemplateWeights,
  compileAdvancedFeatures,
  compileTargets,
  compileTemplateWeights,
  globalRepair,
  globalRepairWithDiagnostics,
  preservationDiagnostics,
  synthesize,
  validateSynthesis,
} from "@survey-synth/synthesis-core";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import type { RelationshipProfile } from "@survey-synth/statistics";
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
      plan.problem.constraints.find((constraint) => constraint.id === "target_0"),
    ).toMatchObject({ coefficients: { template_0: 0.5, template_1: 0 }, rightHandSide: -0.5 });
  });

  it("uses real HiGHS MIP to globally restore conflicting exact marginals", async () => {
    const form: FormSnapshot = {
      questions: [
        {
          id: "choice" as never,
          title: "Choice",
          sectionId: "s" as never,
          required: true,
          affectsNavigation: false,
          kind: "single_choice",
          presentation: "radio",
          options: [
            { key: "a" as never, label: "A" },
            { key: "b" as never, label: "B" },
          ],
          shuffle: false,
        },
      ],
      logic: {
        entrySectionId: "s" as never,
        sections: [{ id: "s" as never, order: 0, questionIds: ["choice" as never] }],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
      sections: [],
      groups: [],
    } as FormSnapshot;
    const make = (id: string, option: "a" | "b", origin: "original" | "synthetic") => ({
      responseId: id as never,
      origin,
      path: { questions: { choice: "reached" } as never, confidence: "certain" as const },
      answers: {
        choice: {
          state: "answered" as const,
          value: { kind: "single_choice" as const, optionKey: option as never, label: option },
        },
      },
    });
    const original = [make("o1", "a", "original"), make("o2", "b", "original")];
    const synthetic = [make("s1", "a", "synthetic"), make("s2", "a", "synthetic")];
    const targets: ProjectTargets = {
      targetResponseCount: 4,
      questionTargets: [
        {
          kind: "option",
          questionId: "choice" as never,
          optionKey: "a" as never,
          target: { kind: "count", value: 2 },
        },
        {
          kind: "option",
          questionId: "choice" as never,
          optionKey: "b" as never,
          target: { kind: "count", value: 2 },
        },
      ],
    };
    const repaired = await globalRepair(
      form,
      original,
      synthetic,
      targets,
      5,
      new HighsOptimizationBackend(),
    );
    expect(repaired).not.toBeNull();
    expect(validateSynthesis(form, original, repaired!, targets).valid).toBe(true);
  });

  it("preserves a selected categorical relationship through real HiGHS allocation", async () => {
    const questions = ["left", "right"].map((id) => ({
      id: id as never,
      title: id,
      sectionId: "s" as never,
      required: true,
      affectsNavigation: false,
      kind: "single_choice" as const,
      presentation: "radio" as const,
      options: [
        { key: "a" as never, label: "A" },
        { key: "b" as never, label: "B" },
      ],
      shuffle: false,
    }));
    const form = {
      questions,
      sections: [],
      groups: [],
      logic: {
        entrySectionId: "s",
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
    } as FormSnapshot;
    const source: NormalizedResponse[] = Array.from({ length: 20 }, (_, index) => {
      const option = index < 10 ? "a" : "b";
      return {
        responseId: `r${index}` as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: Object.fromEntries(
          questions.map((question) => [
            question.id,
            {
              state: "answered",
              value: { kind: "single_choice", optionKey: option, label: option.toUpperCase() },
            },
          ]),
        ),
      } as NormalizedResponse;
    });
    const relationships: RelationshipProfile[] = [
      {
        questionA: "left" as never,
        questionB: "right" as never,
        family: "categorical_categorical",
        method: "cramers_v",
        supportCount: 20,
        strength: 1,
        reliability: 1,
        selectionScore: 1,
        preserveRecommended: true,
        preservationFeatures: ["joint_cells"],
      },
    ];
    const features = compileAdvancedFeatures(form, source, relationships);
    const targets: ProjectTargets = { targetResponseCount: 60, questionTargets: [] };
    const plan = compileTemplateWeights(source, compileTargets(form, source, targets), features);
    const solution = await new HighsOptimizationBackend().solveMixedInteger(plan.problem);
    const allocated = allocateTemplateWeights(plan, solution.values);
    expect(solution.status).toBe("optimal");
    expect(allocated).not.toBeNull();
    const result = synthesize(form, source, targets, 12, allocated!, features);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      const quality = preservationDiagnostics(source, [...source, ...result.synthetic], features);
      expect(quality.relationshipError).toBeLessThan(1e-9);
      expect(quality.marginalError).toBeLessThan(1e-9);
    }

    const shiftedTargets: ProjectTargets = {
      targetResponseCount: 60,
      questionTargets: [
        {
          kind: "option",
          questionId: "left" as never,
          optionKey: "a" as never,
          target: { kind: "count", value: 50 },
        },
      ],
    };
    const shiftedPlan = compileTemplateWeights(
      source,
      compileTargets(form, source, shiftedTargets),
      features,
    );
    const shiftedSolution = await new HighsOptimizationBackend().solveMixedInteger(
      shiftedPlan.problem,
    );
    const shiftedAllocation = allocateTemplateWeights(shiftedPlan, shiftedSolution.values);
    const shifted = synthesize(form, source, shiftedTargets, 12, shiftedAllocation!, features);
    expect(shifted).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 50, satisfied: true }] },
    });
    if (shifted.kind === "success")
      expect(
        preservationDiagnostics(source, [...source, ...shifted.synthetic], features)
          .relationshipError,
      ).toBeGreaterThan(0);
  });

  it("uses GlobalRepair relationship and temporal stages before mutation-cost tie breaking", async () => {
    const form = {
      questions: [
        ...["choice", "group"].map((id) => ({
          id,
          title: id,
          sectionId: "s",
          required: true,
          affectsNavigation: false,
          kind: "single_choice" as const,
          presentation: "radio" as const,
          options: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ],
          shuffle: false,
        })),
        {
          id: "date",
          title: "date",
          sectionId: "s",
          required: true,
          affectsNavigation: false,
          kind: "date" as const,
          includeTime: false,
        },
      ],
      sections: [],
      groups: [],
      logic: {
        entrySectionId: "s",
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
    } as FormSnapshot;
    const make = (
      id: string,
      choice: "a" | "b",
      group: "a" | "b",
      date: string,
      origin: "original" | "synthetic",
    ): NormalizedResponse => ({
      responseId: id as never,
      origin,
      path: { questions: {}, confidence: "certain" },
      answers: {
        choice: {
          state: "answered",
          value: { kind: "single_choice", optionKey: choice as never, label: choice },
        },
        group: {
          state: "answered",
          value: { kind: "single_choice", optionKey: group as never, label: group },
        },
        date: { state: "answered", value: { kind: "date", value: date } },
      },
    });
    const original = [
      make("o1", "a", "a", "2026-01-05", "original"),
      make("o2", "a", "a", "2026-01-05", "original"),
      make("o3", "b", "b", "2026-01-06", "original"),
      make("o4", "b", "b", "2026-01-06", "original"),
    ];
    const synthetic = [
      make("s1", "a", "b", "2026-01-06", "synthetic"),
      make("s2", "b", "a", "2026-01-05", "synthetic"),
    ];
    const relationships: RelationshipProfile[] = [
      {
        questionA: "choice" as never,
        questionB: "group" as never,
        family: "categorical_categorical",
        method: "cramers_v",
        supportCount: 4,
        strength: 1,
        reliability: 1,
        selectionScore: 1,
        preserveRecommended: true,
        preservationFeatures: ["joint_cells"],
      },
      {
        questionA: "choice" as never,
        questionB: "date" as never,
        family: "categorical_numeric",
        method: "eta",
        supportCount: 4,
        strength: 1,
        reliability: 1,
        selectionScore: 1,
        preserveRecommended: true,
        preservationFeatures: ["weekday"],
      },
    ];
    const features = compileAdvancedFeatures(form, original, relationships);
    const targets: ProjectTargets = {
      targetResponseCount: 6,
      questionTargets: [
        {
          kind: "option",
          questionId: "choice" as never,
          optionKey: "a" as never,
          target: { kind: "count", value: 3 },
        },
      ],
    };
    const before = preservationDiagnostics(original, [...original, ...synthetic], features);
    const repair = await globalRepairWithDiagnostics(
      form,
      original,
      synthetic,
      targets,
      9,
      new HighsOptimizationBackend(),
      undefined,
      features,
    );
    expect(repair.status).toBe("optimal");
    expect(repair.rows).not.toBeNull();
    expect(validateSynthesis(form, original, repair.rows!, targets, features).valid).toBe(true);
    const after = preservationDiagnostics(original, [...original, ...repair.rows!], features);
    expect(after.marginalError).toBeLessThanOrEqual(before.marginalError);
    expect(after.relationshipError).toBeLessThan(before.relationshipError);
    expect(after.temporalError).toBeLessThan(before.temporalError);
  });
});
