import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

const form: FormSnapshot = {
  formId: "form" as never,
  title: "Worker fixture",
  capturedAt: "now",
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
  questions: [],
};
const source: NormalizedResponse[] = [
  {
    responseId: "source" as never,
    origin: "original",
    answers: {},
    path: { questions: {}, confidence: "certain" },
  },
];

describe("compiled synthesis worker", () => {
  it("loads as an explicit compiled entry and returns a deterministic result", async () => {
    const result = await new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(new URL("../dist/workers/synthesis-worker.js", import.meta.url));
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.postMessage({
        form,
        source,
        targets: { targetResponseCount: 2, questionTargets: [] },
        seed: 1,
      });
    });
    expect(result).toMatchObject({ kind: "success", synthetic: [{ origin: "synthetic" }] });
  });

  it("uses safe value repair when template-only allocation is infeasible", async () => {
    const result = await new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(new URL("../dist/workers/synthesis-worker.js", import.meta.url));
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.postMessage({
        form: {
          ...form,
          questions: [
            {
              id: "choice" as never,
              title: "Choice",
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
          ],
        },
        source: [
          {
            responseId: "male" as never,
            origin: "original",
            path: { questions: {}, confidence: "certain" },
            answers: {
              choice: {
                state: "answered",
                value: { kind: "single_choice", optionKey: "male" as never, label: "Male" },
              },
            },
          },
        ],
        targets: {
          targetResponseCount: 2,
          questionTargets: [
            {
              kind: "option",
              questionId: "choice" as never,
              optionKey: "female" as never,
              target: { kind: "count", value: 1 },
            },
          ],
        },
        seed: 1,
      });
    });
    expect(result).toMatchObject({
      kind: "success",
      validation: { valid: true, metrics: [{ actual: 1, satisfied: true }] },
    });
  });

  it("runs advanced checkbox preservation inside compiled Worker with HiGHS", async () => {
    const work = {
      form: {
        ...form,
        questions: [
          {
            id: "check" as never,
            title: "Check",
            sectionId: "section" as never,
            required: false,
            affectsNavigation: false,
            kind: "multi_choice",
            presentation: "checkbox",
            options: [
              { key: "x" as never, label: "X" },
              { key: "y" as never, label: "Y" },
            ],
            shuffle: false,
          },
        ],
      },
      source: [
        {
          responseId: "checkbox-source" as never,
          origin: "original",
          path: { questions: { check: "reached" } as never, confidence: "certain" },
          answers: {
            check: {
              state: "answered",
              value: {
                kind: "multi_choice",
                optionKeys: ["x", "y"],
                labels: ["X", "Y"],
              },
            },
          },
        },
      ],
      relationships: [
        {
          questionA: "check",
          questionB: "check",
          family: "checkbox_option_option",
          method: "phi_joint",
          supportCount: 20,
          strength: 1,
          reliability: 1,
          selectionScore: 1,
          preserveRecommended: true,
          preservationFeatures: ["cooccurrence:x:y", "selection_count_distribution"],
        },
      ],
      targets: { targetResponseCount: 2, questionTargets: [] },
      seed: 7,
    };
    const run = (): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../dist/workers/synthesis-worker.js", import.meta.url));
        worker.once("message", (message) => resolve(message as Record<string, unknown>));
        worker.once("error", reject);
        worker.postMessage(work);
      });
    const result = await run();
    expect(result).toMatchObject({
      kind: "success",
      validation: {
        valid: true,
        preservation: { marginalError: 0, relationshipError: 0 },
      },
    });
    expect((await run()).synthetic).toEqual(result.synthetic);
  });

  it("is deterministic through Worker and reports bounded Tiny/Small/Medium repair evidence", async () => {
    const cases = [
      { name: "Tiny", rows: 20, questions: 8 },
      { name: "Small", rows: 50, questions: 20 },
      { name: "Medium", rows: 500, questions: 40 },
    ] as const;
    for (const fixture of cases) {
      const questions = Array.from({ length: fixture.questions }, (_, index) => ({
        id: `q${index}` as never,
        title: `Q${index}`,
        sectionId: "section" as never,
        required: false,
        affectsNavigation: false,
        kind: "single_choice" as const,
        presentation: "radio" as const,
        options: [
          { key: "a" as never, label: "A" },
          { key: "b" as never, label: "B" },
        ],
        shuffle: false,
      }));
      const fixtureForm: FormSnapshot = { ...form, questions };
      const fixtureSource: NormalizedResponse[] = Array.from(
        { length: fixture.rows },
        (_, rowIndex) => ({
          responseId: `${fixture.name}-${rowIndex}` as never,
          origin: "original",
          path: {
            questions: Object.fromEntries(questions.map((question) => [question.id, "reached"])),
            confidence: "certain",
          } as never,
          answers: Object.fromEntries(
            questions.map((question, questionIndex) => {
              const key = (rowIndex + questionIndex) % 2 === 0 ? "a" : "b";
              return [
                question.id,
                {
                  state: "answered",
                  value: { kind: "single_choice", optionKey: key, label: key.toUpperCase() },
                },
              ];
            }),
          ),
        }),
      );
      const finalRows = fixture.rows + Math.max(4, Math.ceil(fixture.rows * 0.1));
      const targets = {
        targetResponseCount: finalRows,
        questionTargets: [
          {
            kind: "option" as const,
            questionId: "q0" as never,
            optionKey: "a" as never,
            target: { kind: "count" as const, value: Math.ceil(finalRows / 2) },
          },
        ],
      };
      const run = (): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const worker = new Worker(
            new URL("../dist/workers/synthesis-worker.js", import.meta.url),
          );
          worker.once("message", (message) => resolve(message as Record<string, unknown>));
          worker.once("error", reject);
          worker.postMessage({
            form: fixtureForm,
            source: fixtureSource,
            targets,
            seed: 2026,
          });
        });
      const startedAt = performance.now();
      const first = await run();
      const elapsedMs = performance.now() - startedAt;
      expect(first).toMatchObject({
        kind: "success",
        validation: { valid: true, finalResponseCount: finalRows },
        advancedDiagnostics: { solverStatus: "optimal" },
      });
      const diagnostics = first.advancedDiagnostics as {
        featureCount: number;
        candidateCount: number;
        constraintCount: number;
        solverStatus: string;
      };
      expect(diagnostics.candidateCount).toBeLessThanOrEqual(400);
      const second = await run();
      expect(second.synthetic).toEqual(first.synthetic);
      console.info("M6_BOUNDEDNESS", {
        name: fixture.name,
        sourceRows: fixture.rows,
        finalRows,
        questions: fixture.questions,
        features: diagnostics.featureCount,
        candidates: diagnostics.candidateCount,
        constraints: diagnostics.constraintCount,
        solverStatus: diagnostics.solverStatus,
        wallTimeMs: Math.round(elapsedMs),
      });
    }
  }, 60_000);
});
