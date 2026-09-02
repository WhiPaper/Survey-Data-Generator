import { parentPort } from "node:worker_threads";

import {
  allocateTemplateWeights,
  checkFeasibility,
  compileTargets,
  compileTemplateWeights,
  synthesize,
} from "@survey-synth/synthesis-core";
import type { FormSnapshot, NormalizedResponse, ProjectTargets } from "@survey-synth/domain";

import { HighsOptimizationBackend } from "../optimization/highs-backend.js";

interface SynthesisWork {
  readonly form: FormSnapshot;
  readonly source: readonly NormalizedResponse[];
  readonly targets: ProjectTargets;
  readonly seed: number;
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
    const plan = compileTemplateWeights(
      work.source,
      compileTargets(work.form, work.source, work.targets),
    );
    void new HighsOptimizationBackend()
      .solveMixedInteger(plan.problem)
      .then((solution) => {
        if (
          solution.status === "infeasible" ||
          solution.status === "error" ||
          solution.status === "unbounded"
        ) {
          port.postMessage(synthesize(work.form, work.source, work.targets, work.seed));
          return;
        }
        const allocated =
          solution.status === "optimal" ? allocateTemplateWeights(plan, solution.values) : null;
        if (allocated === null) {
          port.postMessage(synthesize(work.form, work.source, work.targets, work.seed));
          return;
        }
        port.postMessage(synthesize(work.form, work.source, work.targets, work.seed, allocated));
      })
      .catch(() => port.postMessage({ kind: "worker_error" }));
  } catch {
    port.postMessage({ kind: "worker_error", code: "WORKER_EXCEPTION" });
  }
});
