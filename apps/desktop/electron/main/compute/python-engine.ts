import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";

import { backendFailure } from "../errors";
import type { JobRegistry } from "../jobs";

const MAX_CAPTURED_OUTPUT = 1_000_000;

export type EngineLaunch = {
  command: string;
  argsPrefix: string[];
};

export type EngineSmokeReport = {
  status: "ok";
  kind: "smoke";
  rowCount: number;
  columnCount: number;
  dependencies: Record<string, string>;
  capabilities: {
    parquet: boolean;
    sdvGaussianCopula: boolean;
    scipyMilp: boolean;
    sdmetricsQualityReport: boolean;
  };
};

export type EngineShareAchievement = {
  id: string;
  value: number;
  share: number;
  absoluteError: number;
  exact: boolean;
  bestPossibleShare: number;
  bestPossibleAbsoluteError: number;
};

export type EngineCountAchievement = {
  id: string;
  value: number;
  count: number;
  absoluteError: number;
  exact: boolean;
};

export type EngineConditionalShareAchievement = {
  id: string;
  value: number;
  share: number;
  numeratorCount: number;
  denominatorCount: number;
  absoluteError: number;
  exact: boolean;
};

export type EngineQualityDiagnostics = {
  sdmetricsScore: number | null;
  warning: string | null;
  duplicateRowCount?: number;
  maxFingerprintCount?: number;
  maxFingerprintShare?: number;
  sourceCloneCount?: number;
  sourceCloneRate?: number;
  timestampKsStatistic?: number | null;
  timestampMedianDeltaSeconds?: number | null;
};

export type EngineEditPlanShareOutcome = {
  id: string;
  value: number;
  share: number;
  absoluteError: number;
  exact: boolean;
};

export type EngineEditPlanConditionalOutcome = EngineEditPlanShareOutcome & {
  numeratorCount: number;
  denominatorCount: number;
};

export type EngineEditPlanTargetOutcome = {
  mean: number;
  absoluteError: number;
  exact: boolean;
  shares: EngineEditPlanShareOutcome[];
  counts?: EngineCountAchievement[];
  conditionalShares: EngineEditPlanConditionalOutcome[];
  quality?: EngineQualityDiagnostics;
  duplicateRowCount?: number;
};

export type EngineEditPlan =
  | {
      status: "not_required" | "impossible";
      replacementCount: 0;
      proposedReplacements: [];
      appendOnlyOutcome: EngineEditPlanTargetOutcome;
    }
  | {
      status: "available";
      replacementCount: number;
      proposedReplacements: Array<{
        sourceResponseId: string;
        replacementResponseId: string;
      }>;
      appendOnlyOutcome: EngineEditPlanTargetOutcome;
      replacementOutcome: EngineEditPlanTargetOutcome;
    };

export type EngineSynthesisSuccessReport = {
  status: "success";
  kind: "synthesize";
  sourceCount: number;
  syntheticCount: number;
  finalCount: number;
  candidatePoolCount: number;
  target: {
    kind: "mean";
    column: string;
    value: number;
    minimum: number;
    maximum: number;
  };
  shareTargets: Array<{ id: string; column: string; value: number }>;
  countTargets?: Array<{ id: string; column: string; value: number }>;
  conditionalShareTargets: Array<{
    id: string;
    populationColumn: string;
    optionColumn: string;
    value: number;
  }>;
  achieved: {
    mean: number;
    absoluteError: number;
    exact: boolean;
    bestPossibleMean: number;
    bestPossibleAbsoluteError: number;
    shares: EngineShareAchievement[];
    counts?: EngineCountAchievement[];
    conditionalShares: EngineConditionalShareAchievement[];
  };
  editPlan: EngineEditPlan;
  validation: Record<string, unknown>;
  quality: EngineQualityDiagnostics;
  dependencies: Record<string, string>;
};

export type EngineSynthesisInfeasibleReport = {
  status: "infeasible";
  kind: "synthesize";
  sourceCount: number | null;
  finalCount: number;
  target: { kind: "mean"; column: string; value: number };
  shareTargets: Array<{ id: string; column: string; value: number }>;
  countTargets?: Array<{ id: string; column: string; value: number }>;
  conditionalShareTargets: Array<{
    id: string;
    populationColumn: string;
    optionColumn: string;
    value: number;
  }>;
  issues: Array<{ code: string; message: string }>;
};

export type EngineSynthesisReport = EngineSynthesisSuccessReport | EngineSynthesisInfeasibleReport;

export type ResolveEngineLaunchOptions = {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

export const resolveEngineLaunch = ({
  isPackaged,
  appPath,
  resourcesPath,
  platform = process.platform,
  env = process.env,
}: ResolveEngineLaunchOptions): EngineLaunch => {
  const pathApi = platform === "win32" ? win32 : posix;
  if (isPackaged) {
    return {
      command: pathApi.join(
        resourcesPath,
        "engine",
        platform === "win32" ? "survey-synth-engine.exe" : "survey-synth-engine",
      ),
      argsPrefix: [],
    };
  }

  const explicit = env.SURVEY_SYNTH_ENGINE_EXECUTABLE?.trim();
  if (explicit) return { command: explicit, argsPrefix: [] };

  if (env.SURVEY_SYNTH_PYTHON?.trim()) {
    return {
      command: env.SURVEY_SYNTH_PYTHON.trim(),
      argsPrefix: [pathApi.resolve(appPath, "../../engine/main.py")],
    };
  }
  return platform === "win32"
    ? { command: "py", argsPrefix: ["-3.12", pathApi.resolve(appPath, "../../engine/main.py")] }
    : { command: "python3", argsPrefix: [pathApi.resolve(appPath, "../../engine/main.py")] };
};

export type CreatePythonEngineOptions = {
  jobs: JobRegistry;
  launch: EngineLaunch;
  development?: boolean;
};

export interface PythonEngine {
  selftest(operationId: string, workDir: string): Promise<EngineSmokeReport>;
  synthesize(
    operationId: string,
    jobPath: string,
    reportPath: string,
  ): Promise<EngineSynthesisReport>;
  cancel(operationId: string): boolean;
}

const appendCaptured = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString("utf8");
  return next.length <= MAX_CAPTURED_OUTPUT ? next : next.slice(-MAX_CAPTURED_OUTPUT);
};

const readReport = async (path: string): Promise<unknown> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw backendFailure("INTERNAL", "Python compute engine did not produce report.json");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw backendFailure("INTERNAL", "Python compute engine produced invalid report JSON");
  }
};

const parseSmokeReport = (input: unknown): EngineSmokeReport => {
  if (typeof input !== "object" || input === null) {
    throw backendFailure("INTERNAL", "Python compute engine returned an invalid report");
  }
  const report = input as Record<string, unknown>;
  const capabilities = report.capabilities;
  if (
    report.status !== "ok" ||
    report.kind !== "smoke" ||
    typeof report.rowCount !== "number" ||
    typeof report.columnCount !== "number" ||
    typeof report.dependencies !== "object" ||
    report.dependencies === null ||
    typeof capabilities !== "object" ||
    capabilities === null
  ) {
    throw backendFailure("INTERNAL", "Python compute engine returned an invalid report");
  }
  const caps = capabilities as Record<string, unknown>;
  for (const key of ["parquet", "sdvGaussianCopula", "scipyMilp", "sdmetricsQualityReport"]) {
    if (typeof caps[key] !== "boolean") {
      throw backendFailure("INTERNAL", "Python compute engine returned invalid capabilities");
    }
  }
  return report as EngineSmokeReport;
};

const validShareAchievement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const share = value as Record<string, unknown>;
  return (
    typeof share.id === "string" &&
    typeof share.value === "number" &&
    typeof share.share === "number" &&
    typeof share.absoluteError === "number" &&
    typeof share.exact === "boolean" &&
    typeof share.bestPossibleShare === "number" &&
    typeof share.bestPossibleAbsoluteError === "number"
  );
};

const validCountAchievement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const count = value as Record<string, unknown>;
  return (
    typeof count.id === "string" &&
    typeof count.value === "number" &&
    typeof count.count === "number" &&
    typeof count.absoluteError === "number" &&
    typeof count.exact === "boolean"
  );
};

const validConditionalShareAchievement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const share = value as Record<string, unknown>;
  return (
    typeof share.id === "string" &&
    typeof share.value === "number" &&
    typeof share.share === "number" &&
    typeof share.numeratorCount === "number" &&
    typeof share.denominatorCount === "number" &&
    typeof share.absoluteError === "number" &&
    typeof share.exact === "boolean"
  );
};

const validEditPlanShareOutcome = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const share = value as Record<string, unknown>;
  return (
    typeof share.id === "string" &&
    typeof share.value === "number" &&
    typeof share.share === "number" &&
    typeof share.absoluteError === "number" &&
    typeof share.exact === "boolean"
  );
};

const validEditPlanConditionalOutcome = (value: unknown): boolean => {
  if (!validEditPlanShareOutcome(value)) return false;
  const share = value as Record<string, unknown>;
  return typeof share.numeratorCount === "number" && typeof share.denominatorCount === "number";
};

const validEditPlanTargetOutcome = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.mean === "number" &&
    typeof outcome.absoluteError === "number" &&
    typeof outcome.exact === "boolean" &&
    Array.isArray(outcome.shares) &&
    outcome.shares.every(validEditPlanShareOutcome) &&
    (outcome.counts === undefined ||
      (Array.isArray(outcome.counts) && outcome.counts.every(validCountAchievement))) &&
    Array.isArray(outcome.conditionalShares) &&
    outcome.conditionalShares.every(validEditPlanConditionalOutcome)
  );
};

const validProposedReplacement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const replacement = value as Record<string, unknown>;
  return (
    typeof replacement.sourceResponseId === "string" &&
    replacement.sourceResponseId.length > 0 &&
    typeof replacement.replacementResponseId === "string" &&
    replacement.replacementResponseId.length > 0
  );
};

const validEditPlan = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (
    !["not_required", "available", "impossible"].includes(String(plan.status)) ||
    typeof plan.replacementCount !== "number" ||
    !Number.isInteger(plan.replacementCount) ||
    plan.replacementCount < 0 ||
    !Array.isArray(plan.proposedReplacements) ||
    !plan.proposedReplacements.every(validProposedReplacement) ||
    !validEditPlanTargetOutcome(plan.appendOnlyOutcome)
  ) {
    return false;
  }
  if (plan.status === "available") {
    return (
      plan.replacementCount > 0 &&
      plan.proposedReplacements.length === plan.replacementCount &&
      validEditPlanTargetOutcome(plan.replacementOutcome)
    );
  }
  return plan.replacementCount === 0 && plan.proposedReplacements.length === 0;
};

const parseSynthesisReport = (input: unknown): EngineSynthesisReport => {
  if (typeof input !== "object" || input === null) {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an invalid report");
  }
  const report = input as Record<string, unknown>;
  if (report.kind !== "synthesize") {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an invalid report kind");
  }
  if (report.status === "infeasible") {
    if (
      !Array.isArray(report.issues) ||
      !Array.isArray(report.shareTargets) ||
      !Array.isArray(report.conditionalShareTargets) ||
      typeof report.finalCount !== "number"
    ) {
      throw backendFailure(
        "INTERNAL",
        "Python synthesis engine returned invalid infeasibility diagnostics",
      );
    }
    return input as EngineSynthesisInfeasibleReport;
  }
  if (report.status !== "success") {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an unknown status");
  }
  const achieved = report.achieved;
  const achievedRecord =
    typeof achieved === "object" && achieved !== null
      ? (achieved as Record<string, unknown>)
      : null;
  if (
    typeof report.sourceCount !== "number" ||
    typeof report.syntheticCount !== "number" ||
    typeof report.finalCount !== "number" ||
    !Array.isArray(report.shareTargets) ||
    !Array.isArray(report.conditionalShareTargets) ||
    !achievedRecord ||
    typeof achievedRecord.mean !== "number" ||
    typeof achievedRecord.absoluteError !== "number" ||
    typeof achievedRecord.exact !== "boolean" ||
    typeof achievedRecord.bestPossibleMean !== "number" ||
    typeof achievedRecord.bestPossibleAbsoluteError !== "number" ||
    !Array.isArray(achievedRecord.shares) ||
    !achievedRecord.shares.every(validShareAchievement) ||
    (achievedRecord.counts !== undefined &&
      (!Array.isArray(achievedRecord.counts) ||
        !achievedRecord.counts.every(validCountAchievement))) ||
    !Array.isArray(achievedRecord.conditionalShares) ||
    !achievedRecord.conditionalShares.every(validConditionalShareAchievement) ||
    !validEditPlan(report.editPlan)
  ) {
    throw backendFailure("INTERNAL", "Python synthesis engine returned invalid success metrics");
  }
  return input as EngineSynthesisSuccessReport;
};

const runEngineProcess = async (
  jobs: JobRegistry,
  launch: EngineLaunch,
  operationId: string,
  args: string[],
  development: boolean,
): Promise<void> => {
  let child: ChildProcess | null = null;
  const signal = jobs.start(operationId, () => child?.kill());
  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      let stderr = "";
      try {
        child = spawn(launch.command, [...launch.argsPrefix, ...args], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error: unknown) {
        rejectRun(error);
        return;
      }

      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendCaptured(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendCaptured(stderr, chunk);
      });
      child.once("error", rejectRun);
      child.once("close", (code) => {
        if (signal.aborted) {
          rejectRun(backendFailure("JOB_CANCELLED", "Python compute job was cancelled"));
          return;
        }
        if (code !== 0) {
          if (development) {
            console.error("python_compute_failed", {
              command: launch.command,
              args: [...launch.argsPrefix, ...args],
              exitCode: code,
              stdout,
              stderr,
            });
          }
          rejectRun(
            backendFailure(
              "INTERNAL",
              `Python compute engine exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
        }
        if (development && stderr.trim()) {
          console.error("python_compute_stderr", {
            command: launch.command,
            args: [...launch.argsPrefix, ...args],
            exitCode: code,
            stderr,
          });
        }
        resolveRun();
      });
    }).catch((error: unknown) => {
      if (signal.aborted) throw backendFailure("JOB_CANCELLED", "Python compute job was cancelled");
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw backendFailure(
          "BACKEND_UNAVAILABLE",
          "Python compute engine was not found. Configure Python 3.12 for development or package the engine executable.",
        );
      }
      throw error;
    });
  } finally {
    jobs.finish(operationId);
  }
};

export const createPythonEngine = ({
  jobs,
  launch,
  development = false,
}: CreatePythonEngineOptions): PythonEngine => ({
  selftest: async (operationId, workDir) => {
    await runEngineProcess(
      jobs,
      launch,
      operationId,
      ["selftest", "--work-dir", workDir],
      development,
    );
    return parseSmokeReport(await readReport(join(workDir, "report.json")));
  },

  synthesize: async (operationId, jobPath, reportPath) => {
    await runEngineProcess(
      jobs,
      launch,
      operationId,
      ["synthesize", "--job", jobPath],
      development,
    );
    return parseSynthesisReport(await readReport(reportPath));
  },

  cancel: (operationId) => jobs.cancel(operationId),
});
