import { describe, expect, it } from "vitest";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import { checkFeasibility, compileTargets, synthesize, validateSynthesis } from "../src/index.js";

const form: FormSnapshot = {
  formId: "form" as never,
  title: "M4 fixture",
  capturedAt: "2026-01-01T00:00:00.000Z",
  schemaHash: "schema",
  sections: [],
  groups: [],
  logic: {
    entrySectionId: "section" as never,
    sections: [],
    transitions: [],
    coverage: "none",
    hasRestartFlow: false,
  },
  questions: [
    {
      id: "gender" as never,
      title: "Gender",
      sectionId: "section" as never,
      required: false,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "female" as never, label: "Female" },
        { key: "male" as never, label: "Male" },
      ],
      shuffle: false,
    },
    {
      id: "rating" as never,
      title: "Rating",
      sectionId: "section" as never,
      required: false,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: "income" as never,
      title: "Income",
      sectionId: "section" as never,
      required: false,
      affectsNavigation: false,
      kind: "text",
      presentation: "short",
    },
  ],
};

const rows = (count: number): NormalizedResponse[] =>
  Array.from({ length: count }, (_, index) => ({
    responseId: `original-${index}` as never,
    origin: "original",
    path: { questions: {}, confidence: "certain" },
    answers: {
      gender: {
        state: "answered",
        value: {
          kind: "single_choice",
          optionKey: (index < 2 ? "female" : "male") as never,
          label: index < 2 ? "Female" : "Male",
        },
      },
      rating: { state: "answered", value: { kind: "ordinal", value: index % 2 ? 3 : 4 } },
      income: { state: "answered", value: { kind: "text", value: String(10 + index) } },
    },
  }));

describe("M4 basic synthesis", () => {
  it("subtracts immutable originals from exact final option target", () => {
    const targets: ProjectTargets = {
      targetResponseCount: 20,
      questionTargets: [
        {
          kind: "option",
          questionId: "gender" as never,
          optionKey: "female" as never,
          target: { kind: "count", value: 11 },
        },
      ],
    };
    const compiled = compileTargets(form, rows(5), targets);
    expect(compiled.syntheticResponseCount).toBe(15);
    const result = synthesize(form, rows(5), targets, 7);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.validation?.metrics[0]?.actual).toBe(11);
      expect(result.synthetic).toHaveLength(15);
      expect(result.validation?.originalMutationCount).toBe(0);
    }
  });

  it("uses nearest representable ratio and preserves deterministic output", () => {
    const targets: ProjectTargets = {
      targetResponseCount: 21,
      questionTargets: [
        {
          kind: "option",
          questionId: "gender" as never,
          optionKey: "female" as never,
          target: { kind: "ratio", value: 0.5 },
        },
      ],
    };
    const first = synthesize(form, rows(5), targets, 8);
    const second = synthesize(form, rows(5), targets, 8);
    expect(first.kind).toBe("success");
    expect(second).toEqual(first);
    if (first.kind === "success") expect(first.validation?.metrics[0]?.actual).toBe(11 / 21);
  });

  it("reports ordinary infeasibility without throwing", () => {
    expect(
      checkFeasibility(form, rows(5), { targetResponseCount: 4, questionTargets: [] }).status,
    ).toBe("infeasible");
    expect(
      checkFeasibility(form, rows(5), {
        targetResponseCount: 20,
        questionTargets: [
          {
            kind: "option",
            questionId: "gender" as never,
            optionKey: "female" as never,
            target: { kind: "count", value: 1 },
          },
        ],
      }).issues[0]?.code,
    ).toBe("ORIGINAL_CONTRIBUTION_EXCEEDS_TARGET");
  });

  it("repairs ordinal and numeric means using answered-value denominator", () => {
    const targets: ProjectTargets = {
      targetResponseCount: 10,
      questionTargets: [
        { kind: "mean", questionId: "rating" as never, target: { kind: "mean", value: 4.2 } },
        { kind: "mean", questionId: "income" as never, target: { kind: "mean", value: 12 } },
      ],
    };
    const result = synthesize(form, rows(5), targets, 9);
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.validation?.valid).toBe(true);
  });

  it("treats an ordinal mean as a final-dataset aggregate, not an immutable source mean", () => {
    const source = rows(4).map((row) => ({
      ...row,
      answers: {
        ...row.answers,
        rating: { state: "answered" as const, value: { kind: "ordinal" as const, value: 5 } },
      },
    }));
    const targets: ProjectTargets = {
      targetResponseCount: 8,
      questionTargets: [
        { kind: "mean", questionId: "rating" as never, target: { kind: "mean", value: 3 } },
      ],
    };
    expect(checkFeasibility(form, source, targets).status).toBe("feasible");
    expect(synthesize(form, source, targets, 10)).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 3, satisfied: true }] },
    });
  });

  it("uses the answered denominator for a ratio with skipped source rows", () => {
    const source = rows(2).map((row, index) =>
      index === 0
        ? row
        : { ...row, answers: { ...row.answers, gender: { state: "skipped" as const } } },
    );
    const targets: ProjectTargets = {
      targetResponseCount: 4,
      questionTargets: [
        {
          kind: "option",
          questionId: "gender" as never,
          optionKey: "female" as never,
          target: { kind: "ratio", value: 0.5 },
        },
      ],
    };
    const result = synthesize(form, source, targets, 1);
    expect(
      compileTargets(form, source, targets).aggregateConstraints[0]?.representableValue,
    ).toBeUndefined();
    expect(result).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 0.5, satisfied: true }] },
    });
  });

  it("repairs a ratio range against the answered denominator", () => {
    const targets: ProjectTargets = {
      targetResponseCount: 10,
      questionTargets: [
        {
          kind: "option",
          questionId: "gender" as never,
          optionKey: "female" as never,
          target: { kind: "ratio_range", min: 0.6, max: 0.7 },
        },
      ],
    };
    expect(synthesize(form, rows(5), targets, 2)).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 0.6, satisfied: true }] },
    });
  });

  it("rejects only confirmed required-question violations", () => {
    const requiredForm: FormSnapshot = {
      ...form,
      questions: [{ ...form.questions[0]!, required: true }, ...form.questions.slice(1)],
    };
    const invalid: NormalizedResponse = {
      responseId: "invalid" as never,
      origin: "original",
      path: { questions: { gender: "reached" } as never, confidence: "certain" },
      answers: { gender: { state: "skipped" } },
    };
    const validation = validateSynthesis(requiredForm, [invalid], [], {
      targetResponseCount: 1,
      questionTargets: [],
    });
    expect(validation).toMatchObject({ valid: false, errors: ["REQUIRED_QUESTION_VIOLATION"] });
  });

  it("synthesizes text_cluster targets to nearest representable ratio", () => {
    const textForm: FormSnapshot = {
      ...form,
      questions: [
        {
          id: "city" as never,
          title: "City",
          sectionId: "section" as never,
          required: false,
          affectsNavigation: false,
          kind: "text",
          presentation: "short",
        },
      ],
    };
    const textRows: NormalizedResponse[] = [
      {
        responseId: "r1" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          city: { state: "answered", value: { kind: "text", value: "대구" } },
        },
      },
      {
        responseId: "r2" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          city: { state: "answered", value: { kind: "text", value: "대구광역시" } },
        },
      },
      {
        responseId: "r3" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          city: { state: "answered", value: { kind: "text", value: "서울" } },
        },
      },
      {
        responseId: "r4" as never,
        origin: "original",
        path: { questions: {}, confidence: "certain" },
        answers: {
          city: { state: "answered", value: { kind: "text", value: "서울시" } },
        },
      },
    ];

    const textTargets: ProjectTargets = {
      targetResponseCount: 20,
      questionTargets: [
        {
          kind: "text_cluster",
          questionId: "city" as never,
          clusterId: "tc_daegu",
          label: "대구",
          memberTexts: ["대구", "대구광역시"],
          target: { kind: "ratio", value: 0.7 }, // 70% of 20 = 14 rows
        },
      ],
    };

    const result = synthesize(textForm, textRows, textTargets, 42);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.synthetic).toHaveLength(16);
      const totalRows = [...textRows, ...result.synthetic];
      const daeguCount = totalRows.filter(
        (r) =>
          r.answers.city?.state === "answered" &&
          r.answers.city.value.kind === "text" &&
          ["대구", "대구광역시"].includes(r.answers.city.value.value),
      ).length;
      expect(daeguCount).toBe(14); // 70% of 20
    }
  });
});
