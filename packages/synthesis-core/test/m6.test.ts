import { describe, expect, it } from "vitest";

import {
  resolveResponsePath,
  type FormSnapshot,
  type NormalizedResponse,
  type ProjectTargets,
} from "@survey-synth/domain";
import type { RelationshipProfile } from "@survey-synth/statistics";
import {
  ADVANCED_LIMITS,
  FeatureAccumulator,
  type AdvancedFeature,
  applyGlobalRepair,
  canonicalMetricAggregate,
  canonicalMetricContribution,
  compileAdvancedFeatures,
  compileGlobalRepair,
  compileTargets,
  mutateBranchAnswer,
  synthesize,
  validateSynthesis,
} from "../src/index.js";

const checkboxForm: FormSnapshot = {
  formId: "form" as never,
  title: "M6 checkbox",
  capturedAt: "2026-01-01T00:00:00.000Z",
  schemaHash: "m6",
  sections: [
    { id: "s" as never, title: "", order: 0, questionIds: ["choice" as never, "check" as never] },
  ],
  groups: [],
  logic: {
    entrySectionId: "s" as never,
    sections: [{ id: "s" as never, order: 0, questionIds: ["choice" as never, "check" as never] }],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
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
    {
      id: "check" as never,
      title: "Checkbox",
      sectionId: "s" as never,
      required: false,
      affectsNavigation: false,
      kind: "multi_choice",
      presentation: "checkbox",
      options: [
        { key: "x" as never, label: "X" },
        { key: "y" as never, label: "Y" },
        { key: "z" as never, label: "Z" },
      ],
      shuffle: false,
    },
  ],
};

const row = (id: string, choice: "a" | "b", checks: readonly string[]): NormalizedResponse => ({
  responseId: id as never,
  origin: "original",
  path: { questions: { choice: "reached", check: "reached" } as never, confidence: "certain" },
  answers: {
    choice: {
      state: "answered",
      value: { kind: "single_choice", optionKey: choice as never, label: choice.toUpperCase() },
    },
    check: {
      state: "answered",
      value: {
        kind: "multi_choice",
        optionKeys: checks as never,
        labels: checks.map((value) => value.toUpperCase()),
      },
    },
  },
});

describe("M6 advanced synthesis", () => {
  it("compiles bounded checkbox marginals, selection counts, and recommended co-occurrence", () => {
    const rows = [row("r1", "a", ["x", "y"]), row("r2", "b", ["x"]), row("r3", "a", ["y", "z"])];
    const relationship: RelationshipProfile = {
      questionA: "check" as never,
      questionB: "check" as never,
      family: "checkbox_option_option",
      method: "phi_joint",
      supportCount: 3,
      strength: 0.8,
      reliability: 0.75,
      selectionScore: 0.6,
      preserveRecommended: true,
      preservationFeatures: ["cooccurrence:x:y", "selection_count_distribution"],
    };
    const features = compileAdvancedFeatures(checkboxForm, rows, [relationship]);
    expect(features.some((feature) => feature.kind === "checkbox_option")).toBe(true);
    expect(features.some((feature) => feature.kind === "checkbox_selection_count")).toBe(true);
    expect(features.find((feature) => feature.kind === "checkbox_cooccurrence")).toMatchObject({
      reliability: 0.75,
    });
    expect(
      features.filter((feature) => feature.kind === "checkbox_cooccurrence").length,
    ).toBeLessThanOrEqual(ADVANCED_LIMITS.checkboxPairsPerQuestion);
  });

  it("keeps FeatureAccumulator equal to full recomputation after set mutation", () => {
    const rows = [row("r1", "a", ["x"]), row("r2", "b", ["y"])];
    const features = compileAdvancedFeatures(checkboxForm, rows, []);
    const accumulator = new FeatureAccumulator(features, rows);
    const changed = row("r1", "a", ["x", "z"]);
    accumulator.replace(rows[0]!, changed);
    expect(accumulator.values()).toEqual(
      new FeatureAccumulator(features, [changed, rows[1]!]).values(),
    );
  });

  it("keeps accumulator parity for joint, numeric interaction, and structural state", () => {
    const before = {
      ...row("r1", "a", ["x"]),
      answers: {
        ...row("r1", "a", ["x"]).answers,
        score: { state: "answered" as const, value: { kind: "ordinal" as const, value: 2 } },
      },
    };
    const after = {
      ...row("r1", "b", ["x"]),
      answers: {
        ...row("r1", "b", ["x"]).answers,
        score: { state: "answered" as const, value: { kind: "ordinal" as const, value: 4 } },
      },
    };
    const stable = {
      ...row("r2", "b", ["y"]),
      answers: {
        ...row("r2", "b", ["y"]).answers,
        score: { state: "answered" as const, value: { kind: "ordinal" as const, value: 3 } },
      },
    };
    const features: AdvancedFeature[] = [
      {
        id: "joint",
        kind: "categorical_joint",
        questionA: "choice" as never,
        questionB: "choice" as never,
        optionA: "a" as never,
        optionB: "a" as never,
        sourceValue: 0.5,
        reliability: 1,
        priority: "preserve_relationship",
      },
      {
        id: "numeric",
        kind: "numeric_interaction",
        questionA: "score" as never,
        questionB: "score" as never,
        centerA: 3,
        centerB: 3,
        scaleA: 1,
        scaleB: 1,
        sourceValue: 0.5,
        reliability: 1,
        priority: "preserve_relationship",
      },
      {
        id: "state",
        kind: "answer_state",
        questionA: "check" as never,
        state: "answered",
        sourceValue: 1,
        reliability: 1,
        priority: "preserve_marginal",
      },
    ];
    const accumulator = new FeatureAccumulator(features, [before, stable]);
    accumulator.replace(before, after);
    expect(accumulator.values()).toEqual(
      new FeatureAccumulator(features, [after, stable]).values(),
    );
  });

  it("supports checkbox option and selection-count targets with answered denominator", () => {
    const source = [row("r1", "a", ["x"]), row("r2", "b", ["y"])];
    const targets: ProjectTargets = {
      targetResponseCount: 4,
      questionTargets: [
        {
          kind: "option",
          questionId: "check" as never,
          optionKey: "x" as never,
          target: { kind: "count", value: 3 },
        },
        {
          kind: "selection_count_mean",
          questionId: "check" as never,
          target: { kind: "mean", value: 1.5 },
        },
      ],
    };
    const result = synthesize(checkboxForm, source, targets, 7);
    expect(result).toMatchObject({ kind: "success", validation: { valid: true } });
  });

  it("compiles and validates conditional option goals against scoped population", () => {
    const source = [row("r1", "a", ["x"]), row("r2", "b", ["y"])];
    const targets: ProjectTargets = {
      targetResponseCount: 4,
      questionTargets: [],
      detailedGoals: [
        {
          id: "a-selects-x",
          condition: {
            kind: "option_selected",
            questionId: "choice" as never,
            optionKey: "a" as never,
          },
          outcome: {
            kind: "option",
            questionId: "check" as never,
            optionKey: "x" as never,
            target: { kind: "ratio", value: 1 },
          },
        },
      ],
    };
    expect(synthesize(checkboxForm, source, targets, 3)).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 1, satisfied: true }] },
    });
  });

  it("models compatible candidate conflicts and restores exact option targets", () => {
    const original = [row("o1", "a", []), row("o2", "b", [])];
    const synthetic = [row("s1", "a", []), row("s2", "a", [])].map((item) => ({
      ...item,
      origin: "synthetic" as const,
    }));
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
    const plan = compileGlobalRepair(checkboxForm, original, synthetic, targets, 4);
    expect(
      plan.problem.constraints.filter((constraint) => constraint.id.startsWith("hard_")),
    ).toHaveLength(2);
    const selected = plan.candidates.find(
      (candidate) => candidate.rowIndex === 0 && candidate.id.includes("_b"),
    );
    expect(selected).toBeDefined();
    const repaired = applyGlobalRepair(synthetic, plan, { [selected!.id]: 1 });
    expect(validateSynthesis(checkboxForm, original, repaired, targets).valid).toBe(true);

    const checkboxPlan = compileGlobalRepair(
      checkboxForm,
      original,
      [{ ...row("s3", "a", []), origin: "synthetic" }],
      {
        targetResponseCount: 3,
        questionTargets: [
          {
            kind: "option",
            questionId: "check" as never,
            optionKey: "x" as never,
            target: { kind: "count", value: 1 },
          },
          {
            kind: "option",
            questionId: "check" as never,
            optionKey: "y" as never,
            target: { kind: "count", value: 2 },
          },
        ],
      },
      4,
    );
    expect(
      checkboxPlan.problem.constraints.some((constraint) => constraint.id.startsWith("conflict_")),
    ).toBe(true);
  });
});

describe("M6 structural mutation", () => {
  const form: FormSnapshot = {
    formId: "branch" as never,
    title: "Branch",
    capturedAt: "now",
    schemaHash: "branch",
    groups: [],
    sections: [
      { id: "s1" as never, title: "", order: 0, questionIds: ["branch" as never] },
      { id: "s2" as never, title: "", order: 1, questionIds: ["required" as never] },
    ],
    logic: {
      entrySectionId: "s1" as never,
      sections: [
        {
          id: "s1" as never,
          order: 0,
          questionIds: ["branch" as never],
          nextSectionId: "s2" as never,
        },
        { id: "s2" as never, order: 1, questionIds: ["required" as never] },
      ],
      transitions: [
        {
          sourceQuestionId: "branch" as never,
          optionKey: "yes" as never,
          destination: { type: "section", sectionId: "s2" as never },
          evidence: "api_confirmed",
        },
        {
          sourceQuestionId: "branch" as never,
          optionKey: "no" as never,
          destination: { type: "submit" },
          evidence: "api_confirmed",
        },
      ],
      coverage: "partial",
      hasRestartFlow: false,
    },
    questions: [
      {
        id: "branch" as never,
        title: "Branch",
        sectionId: "s1" as never,
        required: true,
        affectsNavigation: true,
        kind: "single_choice",
        presentation: "radio",
        options: [
          { key: "yes" as never, label: "Yes" },
          { key: "no" as never, label: "No" },
        ],
        shuffle: false,
      },
      {
        id: "required" as never,
        title: "Required",
        sectionId: "s2" as never,
        required: true,
        affectsNavigation: false,
        kind: "ordinal",
        presentation: "linear_scale",
        min: 1,
        max: 5,
      },
    ],
  };
  const branchRow = (id: string, option: "yes" | "no", required?: number): NormalizedResponse => {
    const answers: NormalizedResponse["answers"] = {
      branch: {
        state: "answered",
        value: { kind: "single_choice", optionKey: option as never, label: option },
      },
      required:
        required === undefined
          ? { state: "not_reached" }
          : { state: "answered", value: { kind: "ordinal", value: required } },
    };
    return {
      responseId: id as never,
      origin: "original",
      answers,
      path: resolveResponsePath(form, answers),
    };
  };

  it("recomputes reachability and initializes newly reached required fields from safe donor", () => {
    const target = branchRow("target", "no");
    const donor = branchRow("donor", "yes", 4);
    const result = mutateBranchAnswer(
      form,
      [target, donor],
      { ...target, origin: "synthetic" },
      "branch" as never,
      "yes" as never,
      10,
    );
    expect(result).toMatchObject({
      allowed: true,
      row: { answers: { required: { state: "answered", value: { value: 4 } } } },
    });
    if (result.allowed)
      expect(
        validateSynthesis(form, [], [result.row], { targetResponseCount: 1, questionTargets: [] })
          .valid,
      ).toBe(true);
  });

  it("integrates safe structural mutation into exact branch targets", () => {
    const source = [branchRow("no", "no"), branchRow("yes", "yes", 4)];
    const result = synthesize(
      form,
      source,
      {
        targetResponseCount: 4,
        questionTargets: [
          {
            kind: "option",
            questionId: "branch" as never,
            optionKey: "yes" as never,
            target: { kind: "count", value: 3 },
          },
        ],
      },
      11,
    );
    expect(result).toMatchObject({ kind: "success", validation: { valid: true } });
    if (result.kind === "success")
      expect(result.validation?.errors).not.toContain("BRANCH_CONTRADICTION");
  });

  it("rejects ambiguous and donorless structural mutations transactionally", () => {
    const target = branchRow("target", "no");
    expect(
      mutateBranchAnswer(
        form,
        [],
        { ...target, origin: "synthetic" },
        "branch" as never,
        "yes" as never,
        1,
      ),
    ).toMatchObject({ allowed: false, reason: "no_donor_support" });
    expect(
      mutateBranchAnswer(
        form,
        [],
        { ...target, path: { ...target.path, confidence: "ambiguous" }, origin: "synthetic" },
        "branch" as never,
        "yes" as never,
        1,
      ),
    ).toEqual({ allowed: false, reason: "logic_ambiguous" });
  });

  it("never donor-copies date, time, free text, file, or unsupported answers", () => {
    const blocked = [
      {
        question: {
          kind: "date",
          includeTime: false,
          includeYear: true,
        },
        value: { kind: "date", value: "2026-01-01", includeTime: false, includeYear: true },
      },
      {
        question: { kind: "time", duration: false },
        value: { kind: "time", value: "12:00", duration: false },
      },
      {
        question: { kind: "text", presentation: "paragraph" },
        value: { kind: "text", value: "private free text" },
      },
      {
        question: { kind: "file", allowedTypes: [], maxFiles: 1 },
        value: { kind: "file", files: [] },
      },
      {
        question: { kind: "unsupported", sourceType: "unknown" },
        value: { kind: "unsupported", values: ["opaque"] },
      },
    ] as const;
    for (const [index, fixture] of blocked.entries()) {
      const blockedForm = {
        ...form,
        questions: [
          form.questions[0]!,
          {
            id: "required",
            title: "Required",
            sectionId: "s2",
            required: true,
            affectsNavigation: false,
            ...fixture.question,
          },
        ],
      } as FormSnapshot;
      const targetAnswers: NormalizedResponse["answers"] = {
        branch: {
          state: "answered",
          value: { kind: "single_choice", optionKey: "no" as never, label: "no" },
        },
        required: { state: "not_reached" },
      };
      const donorAnswers: NormalizedResponse["answers"] = {
        branch: {
          state: "answered",
          value: { kind: "single_choice", optionKey: "yes" as never, label: "yes" },
        },
        required: { state: "answered", value: fixture.value as never },
      };
      const target: NormalizedResponse = {
        responseId: `blocked-target-${index}` as never,
        origin: "synthetic",
        answers: targetAnswers,
        path: resolveResponsePath(blockedForm, targetAnswers),
      };
      const donor: NormalizedResponse = {
        responseId: `blocked-donor-${index}` as never,
        origin: "original",
        answers: donorAnswers,
        path: resolveResponsePath(blockedForm, donorAnswers),
      };
      expect(
        mutateBranchAnswer(blockedForm, [donor], target, "branch" as never, "yes" as never, 1),
      ).toEqual({ allowed: false, reason: "no_donor_support" });
    }
  });

  it("keeps donor choice deterministic and rejects restart destinations", () => {
    const target = branchRow("target", "no");
    const donors = [branchRow("donor-a", "yes", 2), branchRow("donor-b", "yes", 5)];
    const first = mutateBranchAnswer(
      form,
      donors,
      { ...target, origin: "synthetic" },
      "branch" as never,
      "yes" as never,
      99,
    );
    const second = mutateBranchAnswer(
      form,
      donors,
      { ...target, origin: "synthetic" },
      "branch" as never,
      "yes" as never,
      99,
    );
    expect(second).toEqual(first);
    const restartForm: FormSnapshot = {
      ...form,
      logic: {
        ...form.logic,
        hasRestartFlow: true,
        transitions: form.logic.transitions.map((transition) =>
          transition.optionKey === "yes"
            ? { ...transition, destination: { type: "restart" as const } }
            : transition,
        ),
      },
    };
    expect(
      mutateBranchAnswer(
        restartForm,
        donors,
        { ...target, origin: "synthetic" },
        "branch" as never,
        "yes" as never,
        1,
      ),
    ).toEqual({ allowed: false, reason: "restart_flow" });
  });

  it("uses post-mutation denominators for structural ratio and mean constraints", () => {
    const downstreamForm: FormSnapshot = {
      ...form,
      questions: [
        form.questions[0]!,
        {
          id: "required" as never,
          title: "Required",
          sectionId: "s2" as never,
          required: true,
          affectsNavigation: false,
          kind: "single_choice",
          presentation: "radio",
          options: [
            { key: "x" as never, label: "X" },
            { key: "y" as never, label: "Y" },
          ],
          shuffle: false,
        },
      ],
    };
    const make = (
      id: string,
      branch: "yes" | "no",
      downstream?: "x" | "y",
      origin: "original" | "synthetic" = "original",
    ): NormalizedResponse => {
      const answers: NormalizedResponse["answers"] = {
        branch: {
          state: "answered",
          value: { kind: "single_choice", optionKey: branch as never, label: branch },
        },
        required:
          downstream === undefined
            ? { state: "not_reached" }
            : {
                state: "answered",
                value: {
                  kind: "single_choice",
                  optionKey: downstream as never,
                  label: downstream,
                },
              },
      };
      return {
        responseId: id as never,
        origin,
        answers,
        path: resolveResponsePath(downstreamForm, answers),
      };
    };
    const original = [make("yes", "yes", "x"), make("no", "no")];
    const synthetic = [make("synthetic", "no", undefined, "synthetic")];
    const targets: ProjectTargets = {
      targetResponseCount: 3,
      questionTargets: [
        {
          kind: "option",
          questionId: "branch" as never,
          optionKey: "yes" as never,
          target: { kind: "count", value: 2 },
        },
        {
          kind: "option",
          questionId: "required" as never,
          optionKey: "x" as never,
          target: { kind: "ratio", value: 1 },
        },
      ],
    };
    const plan = compileGlobalRepair(downstreamForm, original, synthetic, targets, 3);
    const structural = plan.candidates.find((candidate) => candidate.structural);
    expect(structural).toBeDefined();
    expect(structural?.metricDeltas[1]).toEqual({ numerator: 1, denominator: 1 });
    expect(
      plan.problem.constraints.find((constraint) => constraint.id === "target_1_den_link")
        ?.coefficients[structural!.id],
    ).toBe(1);

    const compiled = compileTargets(downstreamForm, original, targets).aggregateConstraints;
    compiled.forEach((constraint, index) => {
      const base = canonicalMetricAggregate([...original, ...synthetic], constraint.metric);
      const before = canonicalMetricContribution(synthetic[0]!, constraint.metric);
      const after = canonicalMetricContribution(structural!.row, constraint.metric);
      expect({
        numerator: base.numerator + structural!.metricDeltas[index]!.numerator,
        denominator: base.denominator + structural!.metricDeltas[index]!.denominator,
      }).toEqual({
        numerator: base.numerator + after.numerator - before.numerator,
        denominator: base.denominator + after.denominator - before.denominator,
      });
    });
  });

  it("uses explicit temporal buckets and lexicographic repair stages", () => {
    const temporalForm: FormSnapshot = {
      ...checkboxForm,
      questions: [
        ...checkboxForm.questions,
        {
          id: "date" as never,
          title: "Date",
          sectionId: "s" as never,
          required: false,
          affectsNavigation: false,
          kind: "date",
          includeTime: false,
        },
      ],
    };
    const rows = [row("r1", "a", ["x"]), row("r2", "b", ["y"])].map((item, index) => ({
      ...item,
      answers: {
        ...item.answers,
        date: {
          state: "answered" as const,
          value: { kind: "date" as const, value: `2026-01-0${index + 1}` },
        },
      },
    }));
    const relationship: RelationshipProfile = {
      questionA: "choice" as never,
      questionB: "date" as never,
      family: "categorical_numeric",
      method: "eta",
      supportCount: 2,
      strength: 1,
      reliability: 1,
      selectionScore: 1,
      preserveRecommended: true,
      preservationFeatures: ["weekday"],
    };
    const features = compileAdvancedFeatures(temporalForm, rows, [relationship]);
    expect(features.some((feature) => feature.kind === "temporal_bucket")).toBe(true);
    expect(features.some((feature) => feature.kind === "temporal_joint")).toBe(true);
    expect(
      features.some(
        (feature) =>
          feature.kind === "numeric_interaction" && feature.priority === "preserve_temporal",
      ),
    ).toBe(false);
    const synthetic = [{ ...rows[0]!, origin: "synthetic" as const }];
    const plan = compileGlobalRepair(
      temporalForm,
      rows,
      synthetic,
      { targetResponseCount: 3, questionTargets: [] },
      1,
      features,
    );
    expect(plan.objectiveStages.map((stage) => stage.priority)).toEqual([
      "preserve_marginal",
      "preserve_temporal",
      "diversity",
      "mutation_cost",
      "stable_tie",
    ]);
    expect(plan.diagnostics.candidateCount).toBeLessThanOrEqual(ADVANCED_LIMITS.mutationCandidates);
  });
});
