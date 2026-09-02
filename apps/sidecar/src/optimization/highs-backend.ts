import { createRequire } from "node:module";

import type {
  CancellationSignal,
  LinearConstraint,
  OptimizationBackend,
  OptimizationProblem,
  OptimizationSolution,
} from "@survey-synth/synthesis-core";

interface HighsResult {
  readonly Status: string;
  readonly Columns: Readonly<Record<string, { readonly Primal?: number }>>;
}

interface HighsInstance {
  solve(problem: string, options: { output_flag: boolean; log_to_console: boolean }): HighsResult;
}

const require = createRequire(import.meta.url);
const highsLoader = require("highs") as () => Promise<HighsInstance>;

const finite = (value: number): string => {
  if (!Number.isFinite(value)) throw new Error("Optimization IR cannot contain non-finite values");
  return String(value);
};

const name = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw new Error("Invalid optimization variable name");
  return value;
};

const expression = (constraint: LinearConstraint): string => {
  const terms = Object.entries(constraint.coefficients).filter(
    ([, coefficient]) => coefficient !== 0,
  );
  return terms.length === 0
    ? "0"
    : terms
        .map(([variable, coefficient], index) => {
          const absolute = `${Math.abs(coefficient)} ${name(variable)}`;
          if (index === 0) return coefficient < 0 ? `- ${absolute}` : absolute;
          return coefficient < 0 ? ` - ${absolute}` : ` + ${absolute}`;
        })
        .join("");
};

const renderLp = (problem: OptimizationProblem, mixedInteger: boolean): string => {
  const constraints = problem.constraints.map(
    (constraint) =>
      `${name(constraint.id)}: ${expression(constraint)} ${constraint.relation} ${finite(constraint.rightHandSide)}`,
  );
  const bounds = problem.variables.map(
    (variable) =>
      `${finite(variable.lowerBound)} <= ${name(variable.id)}${variable.upperBound === undefined ? "" : ` <= ${finite(variable.upperBound)}`}`,
  );
  const integers = mixedInteger
    ? problem.variables.filter((variable) => variable.integer).map((variable) => name(variable.id))
    : [];
  const objective = Object.entries(problem.objective?.coefficients ?? {})
    .filter(([, coefficient]) => coefficient !== 0)
    .map(([variable, coefficient], index) => {
      const absolute = `${Math.abs(coefficient)} ${name(variable)}`;
      if (index === 0) return coefficient < 0 ? `- ${absolute}` : absolute;
      return coefficient < 0 ? ` - ${absolute}` : ` + ${absolute}`;
    })
    .join("");
  return [
    "Minimize",
    ` obj: ${objective === "" ? "0" : objective}`,
    "Subject To",
    ...constraints,
    "Bounds",
    ...bounds,
    ...(integers.length ? ["Generals", ...integers] : []),
    "End",
  ].join("\n");
};

const status = (value: string): OptimizationSolution["status"] => {
  if (value === "Optimal" || value === "Empty") return "optimal";
  if (value === "Infeasible") return "infeasible";
  if (value === "Unbounded" || value === "Primal infeasible or unbounded") return "unbounded";
  return "error";
};

/** Concrete HiGHS/WASM adapter. Solver-specific LP text remains in sidecar. */
export class HighsOptimizationBackend implements OptimizationBackend {
  private readonly highs = highsLoader();

  public solveLinear(
    problem: OptimizationProblem,
    signal?: CancellationSignal,
  ): Promise<OptimizationSolution> {
    return this.solve(problem, false, signal);
  }

  public solveMixedInteger(
    problem: OptimizationProblem,
    signal?: CancellationSignal,
  ): Promise<OptimizationSolution> {
    return this.solve(problem, true, signal);
  }

  private async solve(
    problem: OptimizationProblem,
    mixedInteger: boolean,
    signal?: CancellationSignal,
  ): Promise<OptimizationSolution> {
    if (signal?.aborted) return { status: "cancelled", values: {} };
    try {
      const result = (await this.highs).solve(renderLp(problem, mixedInteger), {
        output_flag: false,
        log_to_console: false,
      });
      if (signal?.aborted) return { status: "cancelled", values: {} };
      const values: Record<string, number> = {};
      for (const [id, column] of Object.entries(result.Columns)) {
        if (column.Primal !== undefined) values[id] = column.Primal;
      }
      return { status: status(result.Status), values };
    } catch {
      return { status: "error", values: {} };
    }
  }
}
