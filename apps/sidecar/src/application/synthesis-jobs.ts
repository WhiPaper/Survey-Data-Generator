import { Worker } from "node:worker_threads";

import type { ProjectTargets } from "@survey-synth/domain";
import type { SynthesisResult } from "@survey-synth/synthesis-core";

import { sidecarError } from "../errors.js";
import type { ProjectRepository, SynthesisSource } from "../persistence/projects.js";

export interface SynthesisWorker {
  once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
}

export type SynthesisWorkerFactory = () => SynthesisWorker;

export class SynthesisJobs {
  private readonly active = new Map<string, SynthesisWorker>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly createWorker: SynthesisWorkerFactory = () =>
      new Worker(new URL("../workers/synthesis-worker.js", import.meta.url)),
  ) {}

  public async run(
    operationId: string,
    projectId: string,
    source: SynthesisSource,
    targets: ProjectTargets,
    seed: number,
  ): Promise<
    | {
        readonly runId: string;
        readonly syntheticResponseCount: number;
        readonly finalResponseCount: number;
      }
    | {
        readonly status: "infeasible" | "unsupported";
        readonly issues: readonly { code: string; message: string }[];
      }
  > {
    if (this.active.has(operationId))
      throw sidecarError("VALIDATION_FAILED", "Synthesis operation id is already active", true);
    const result = await new Promise<SynthesisResult>((resolve, reject) => {
      const worker = this.createWorker();
      this.active.set(operationId, worker);
      worker.once("message", (message) => {
        const result = message as SynthesisResult | { kind: "worker_error"; code?: string };
        if ("kind" in result && result.kind === "worker_error")
          reject(
            sidecarError("INTERNAL", `Synthesis worker failed (${result.code ?? "unknown"})`, true),
          );
        else resolve(result);
      });
      worker.once("error", () => reject(sidecarError("INTERNAL", "Synthesis worker failed", true)));
      worker.once("exit", (code) => {
        if (code !== 0 && this.active.has(operationId))
          reject(sidecarError("JOB_CANCELLED", "Synthesis cancelled", true));
      });
      worker.postMessage({ form: source.form, source: source.responses, targets, seed });
    }).finally(() => {
      const worker = this.active.get(operationId);
      this.active.delete(operationId);
      void worker?.terminate();
    });
    if (result.kind === "infeasible")
      return {
        status: result.feasibility.status === "unknown" ? "unsupported" : "infeasible",
        issues: result.feasibility.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
        })),
      };
    const run = this.projects.saveRun({
      projectId: projectId as never,
      sourceRevisionId: source.sourceRevisionId,
      targets,
      seed,
      synthetic: result.synthetic,
      validation: result.validation!,
    });
    return {
      runId: run.id,
      syntheticResponseCount: result.synthetic.length,
      finalResponseCount: result.validation!.finalResponseCount,
    };
  }

  public cancel(operationId: string): boolean {
    const worker = this.active.get(operationId);
    if (worker === undefined) return false;
    void worker.terminate();
    return true;
  }

  public shutdown(): void {
    for (const operationId of this.active.keys()) this.cancel(operationId);
  }
}
