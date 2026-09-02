import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import type { FormSnapshot, NormalizedResponse } from "@survey-synth/domain";

import { SynthesisJobs, type SynthesisWorker } from "../src/application/synthesis-jobs.js";

class PendingWorker implements SynthesisWorker {
  private readonly listeners = new Map<string, (value: unknown) => void>();
  public once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown {
    this.listeners.set(event, listener);
  }
  public postMessage(): void {}
  public async terminate(): Promise<number> {
    this.listeners.get("exit")?.(1);
    return 1;
  }
}

class CompletingWorker implements SynthesisWorker {
  private readonly listeners = new Map<string, (value: unknown) => void>();
  public constructor(private readonly afterMessage: () => void) {}
  public once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown {
    this.listeners.set(event, listener);
  }
  public postMessage(): void {
    this.listeners.get("message")?.({
      kind: "success",
      synthetic: [],
      feasibility: { status: "feasible", strategy: "resampling_only", issues: [], bounds: [] },
      validation: {
        valid: true,
        originalMutationCount: 0,
        finalResponseCount: 0,
        metrics: [],
        errors: [],
      },
    });
    this.afterMessage();
  }
  public async terminate(): Promise<number> {
    return 0;
  }
}

describe("synthesis job cancellation", () => {
  it("terminates active worker and never persists a cancelled Run", async () => {
    const worker = new PendingWorker();
    const projects = {
      saveRun: () => {
        throw new Error("cancelled synthesis must not persist");
      },
    };
    const jobs = new SynthesisJobs(projects as never, () => worker);
    const pending = jobs.run(
      "job",
      "project",
      { form: {} as never, responses: [], sourceRevisionId: "revision" as never },
      { targetResponseCount: 0, questionTargets: [] },
      1,
      0,
    );
    expect(jobs.cancel("job")).toBe(true);
    await expect(pending).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
  });

  it("rejects cancellation after worker completion but before Run persistence", async () => {
    let jobs!: SynthesisJobs;
    let saved = false;
    const worker = new CompletingWorker(() => jobs.cancel("race"));
    jobs = new SynthesisJobs(
      {
        saveRun: () => {
          saved = true;
          return { id: "run" };
        },
      } as never,
      () => worker,
    );
    await expect(
      jobs.run(
        "race",
        "project",
        { form: {} as never, responses: [], sourceRevisionId: "revision" as never },
        { targetResponseCount: 0, questionTargets: [] },
        1,
        2,
      ),
    ).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
    expect(saved).toBe(false);
  });

  it("starts a clean worker successfully after cancellation", async () => {
    const workers: SynthesisWorker[] = [new PendingWorker(), new CompletingWorker(() => {})];
    let created = 0;
    const jobs = new SynthesisJobs(
      { saveRun: () => ({ id: "recovered-run" }) } as never,
      () => workers[created++]!,
    );
    const source = {
      form: {} as never,
      responses: [],
      sourceRevisionId: "revision" as never,
      relationships: [],
    };
    const cancelled = jobs.run(
      "first",
      "project",
      source,
      { targetResponseCount: 0, questionTargets: [] },
      1,
      1,
    );
    jobs.cancel("first");
    await expect(cancelled).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
    await expect(
      jobs.run("second", "project", source, { targetResponseCount: 0, questionTargets: [] }, 1, 1),
    ).resolves.toMatchObject({ runId: "recovered-run", finalResponseCount: 0 });
  });

  it("cancels an actual advanced Worker with no Run, then recovers on another advanced Run", async () => {
    const questions = Array.from({ length: 20 }, (_, index) => ({
      id: `q${index}` as never,
      title: `Q${index}`,
      sectionId: "s" as never,
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
    const form: FormSnapshot = {
      formId: "advanced-cancel" as never,
      title: "Advanced cancel",
      capturedAt: "now",
      schemaHash: "advanced-cancel",
      sections: [],
      groups: [],
      questions,
      logic: {
        entrySectionId: "s" as never,
        sections: [],
        transitions: [],
        coverage: "none",
        hasRestartFlow: false,
      },
    };
    const responses: NormalizedResponse[] = Array.from({ length: 200 }, (_, rowIndex) => ({
      responseId: `r${rowIndex}` as never,
      origin: "original",
      path: { questions: {}, confidence: "certain" },
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
    }));
    let saves = 0;
    const jobs = new SynthesisJobs(
      {
        saveRun: () => {
          saves++;
          return { id: `run-${saves}` };
        },
      } as never,
      () =>
        new Worker(
          new URL("../dist/workers/synthesis-worker.js", import.meta.url),
        ) as unknown as SynthesisWorker,
    );
    const source = {
      form,
      responses,
      sourceRevisionId: "revision" as never,
      relationships: [],
    };
    const targets = {
      targetResponseCount: 220,
      questionTargets: [
        {
          kind: "option" as const,
          questionId: "q0" as never,
          optionKey: "a" as never,
          target: { kind: "count" as const, value: 110 },
        },
      ],
    };
    const cancelled = jobs.run("advanced-cancel", "project", source, targets, 77, 1);
    expect(jobs.cancel("advanced-cancel")).toBe(true);
    await expect(cancelled).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
    expect(saves).toBe(0);
    await expect(
      jobs.run("advanced-recovery", "project", source, targets, 77, 1),
    ).resolves.toMatchObject({ runId: "run-1", finalResponseCount: 220 });
    expect(saves).toBe(1);
  }, 30_000);
});
