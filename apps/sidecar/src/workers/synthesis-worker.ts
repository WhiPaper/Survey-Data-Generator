import { parentPort } from "node:worker_threads";

import {
  allocateTemplateWeights,
  checkFeasibility,
  compileTargets,
  compileTemplateWeights,
  compileAdvancedFeatures,
  globalRepairWithDiagnostics,
  synthesize,
  validateSynthesis,
} from "@survey-synth/synthesis-core";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";
import type { RelationshipProfile } from "@survey-synth/statistics";

import { HighsOptimizationBackend } from "../optimization/highs-backend.js";

interface SynthesisWork {
  readonly form: FormSnapshot;
  readonly source: readonly NormalizedResponse[];
  readonly targets: ProjectTargets;
  readonly seed: number;
  readonly relationships?: readonly RelationshipProfile[];
}

const port = parentPort;
if (port === null) throw new Error("Synthesis worker requires parent port");

port.on("message", (work: SynthesisWork) => {
  try {
    const feasibility = checkFeasibility(work.form, work.source, work.targets);
    if (feasibility.status !== "feasible") {
      port.postMessage({ kind: "infeasible", synthetic: [], feasibility });
      return;
    }
    if (work.targets.targetResponseCount === work.source.length) {
      port.postMessage(synthesize(work.form, work.source, work.targets, work.seed));
      return;
    }
    const advancedFeatures = compileAdvancedFeatures(
      work.form,
      work.source,
      work.relationships ?? [],
    );
    const plan = compileTemplateWeights(
      work.source,
      compileTargets(work.form, work.source, work.targets),
      advancedFeatures,
    );
    const backend = new HighsOptimizationBackend();
    const finish = async (allocated?: readonly number[]): Promise<void> => {
      const initial = synthesize(
        work.form,
        work.source,
        work.targets,
        work.seed,
        allocated,
        advancedFeatures,
      );
      if (initial.kind !== "success") {
        port.postMessage(initial);
        return;
      }
      const repair = await globalRepairWithDiagnostics(
        work.form,
        work.source,
        initial.synthetic,
        work.targets,
        work.seed,
        backend,
        undefined,
        advancedFeatures,
      );
      if (repair.rows === null) {
        port.postMessage({
          kind: "infeasible",
          synthetic: [],
          feasibility: {
            status: "infeasible",
            strategy: null,
            issues: [
              {
                location: { type: "target-size" },
                code:
                  repair.status === "candidate_limit"
                    ? "REPAIR_CANDIDATE_LIMIT"
                    : "REPAIR_INFEASIBLE",
                message:
                  repair.status === "candidate_limit"
                    ? "Global repair candidate limit prevented a conclusive result"
                    : "Global repair could not satisfy the requested constraints",
              },
            ],
            bounds: [],
          },
          advancedDiagnostics: repair.diagnostics,
        });
        return;
      }
      const validation = validateSynthesis(
        work.form,
        work.source,
        repair.rows,
        work.targets,
        advancedFeatures,
      );
      port.postMessage(
        validation.valid
          ? {
              ...initial,
              synthetic: repair.rows,
              validation,
              advancedDiagnostics: repair.diagnostics,
            }
          : {
              kind: "infeasible",
              synthetic: [],
              feasibility: {
                status: "infeasible",
                strategy: null,
                issues: validation.errors.map((message) => ({
                  location: { type: "target-size" },
                  code: "VALIDATION_FAILED",
                  message,
                })),
                bounds: [],
              },
              validation,
            },
      );
    };
    void backend
      .solveMixedInteger(plan.problem)
      .then(async (solution) => {
        if (
          solution.status === "infeasible" ||
          solution.status === "error" ||
          solution.status === "unbounded"
        ) {
          await finish();
          return;
        }
        const allocated =
          solution.status === "optimal" ? allocateTemplateWeights(plan, solution.values) : null;
        if (allocated === null) {
          await finish();
          return;
        }
        await finish(allocated);
      })
      .catch(() => port.postMessage({ kind: "worker_error" }));
  } catch {
    port.postMessage({ kind: "worker_error", code: "WORKER_EXCEPTION" });
  }
});
