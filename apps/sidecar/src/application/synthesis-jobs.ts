import { Worker } from "node:worker_threads";

import type { ProjectTargets } from "@survey-synth/domain";
import type { SynthesisResult } from "@survey-synth/synthesis-core";

import { sidecarError } from "../errors.js";
import type { ProjectRepository, SynthesisSource } from "../persistence/projects.js";
import { safeErrorContext, type SafeLogger } from "../rpc/logger.js";

export interface SynthesisWorker {
  once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
}

export type SynthesisWorkerFactory = () => SynthesisWorker;

export class SynthesisJobs {
  private readonly active = new Map<string, SynthesisWorker>();
  private readonly cancelled = new Set<string>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly createWorker: SynthesisWorkerFactory = () =>
      new Worker(new URL("../workers/synthesis-worker.js", import.meta.url)),
    private readonly logger?: SafeLogger,
  ) {}

  public async run(
    operationId: string,
    projectId: string,
    source: SynthesisSource,
    targets: ProjectTargets,
    seed: number,
    targetRevision: number,
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
    try {
      const result = await new Promise<SynthesisResult>((resolve, reject) => {
        const worker = this.createWorker();
        this.active.set(operationId, worker);
        worker.once("message", (message) => {
          const result = message as SynthesisResult | { kind: "worker_error"; code?: string };
          if ("kind" in result && result.kind === "worker_error") {
            this.logger?.error("synthesis_worker_failed", {
              errorCode: "INTERNAL",
              phase: "worker",
              requestId: operationId,
              workerCode: result.code ?? "unknown",
            });
            reject(
              sidecarError(
                "INTERNAL",
                `Synthesis worker failed (${result.code ?? "unknown"})`,
                true,
              ),
            );
          } else resolve(result);
        });
        worker.once("error", (error) => {
          this.logger?.error("synthesis_worker_failed", {
            errorCode: "INTERNAL",
            phase: "worker",
            requestId: operationId,
            ...safeErrorContext(error),
          });
          reject(sidecarError("INTERNAL", "Synthesis worker failed", true));
        });
        worker.once("exit", (code) => {
          if (this.cancelled.has(operationId) && this.active.has(operationId))
            reject(sidecarError("JOB_CANCELLED", "Synthesis cancelled", true));
          else if (code !== 0 && this.active.has(operationId)) {
            const exitCode = typeof code === "number" ? code : -1;
            this.logger?.error("synthesis_worker_exited", {
              errorCode: "INTERNAL",
              phase: "worker",
              requestId: operationId,
              exitCode,
            });
            reject(sidecarError("INTERNAL", "Synthesis worker exited unexpectedly", true));
          }
        });
        worker.postMessage({
          form: source.form,
          source: source.responses,
          targets,
          seed,
          relationships: source.relationships,
        });
      }).finally(() => {
        const worker = this.active.get(operationId);
        this.active.delete(operationId);
        void worker?.terminate();
      });
      if (this.cancelled.has(operationId))
        throw sidecarError("JOB_CANCELLED", "Synthesis cancelled", true);
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
        targetRevision,
      });
      return {
        runId: run.id,
        syntheticResponseCount: result.synthetic.length,
        finalResponseCount: result.validation!.finalResponseCount,
      };
    } finally {
      this.cancelled.delete(operationId);
    }
  }

  public cancel(operationId: string): boolean {
    const worker = this.active.get(operationId);
    if (worker === undefined) return false;
    this.cancelled.add(operationId);
    void worker.terminate();
    return true;
  }

  public shutdown(): void {
    for (const operationId of this.active.keys()) this.cancel(operationId);
  }
}
