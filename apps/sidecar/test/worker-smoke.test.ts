import { Worker } from "node:worker_threads";

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
});
