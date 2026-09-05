import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
  achieved: {
    mean: number;
    absoluteError: number;
    exact: boolean;
  };
  validation: Record<string, unknown>;
  quality: {
    sdmetricsScore: number | null;
    warning: string | null;
  };
  dependencies: Record<string, string>;
};

export type EngineSynthesisInfeasibleReport = {
  status: "infeasible";
  kind: "synthesize";
  sourceCount: number | null;
  finalCount: number;
  target: { kind: "mean"; column: string; value: number };
  issues: Array<{ code: string; message: string }>;
};

export type EngineSynthesisReport =
  | EngineSynthesisSuccessReport
  | EngineSynthesisInfeasibleReport;

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
  const explicit = env.SURVEY_SYNTH_ENGINE_EXECUTABLE?.trim();
  if (explicit) return { command: explicit, argsPrefix: [] };

  if (isPackaged) {
    return {
      command: join(
        resourcesPath,
        "engine",
        platform === "win32" ? "survey-synth-engine.exe" : "survey-synth-engine",
      ),
      argsPrefix: [],
    };
  }

  return {
    command:
      env.SURVEY_SYNTH_PYTHON?.trim() || (platform === "win32" ? "python" : "python3"),
    argsPrefix: [resolve(appPath, "../../engine/main.py")],
  };
};

export type CreatePythonEngineOptions = {
  jobs: JobRegistry;
  launch: EngineLaunch;
};

export interface PythonEngine {
  selftest(operationId: string, workDir: string): Promise<EngineSmokeReport>;
  synthesize(operationId: string, jobPath: string, reportPath: string): Promise<EngineSynthesisReport>;
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

const parseSynthesisReport = (input: unknown): EngineSynthesisReport => {
  if (typeof input !== "object" || input === null) {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an invalid report");
  }
  const report = input as Record<string, unknown>;
  if (report.kind !== "synthesize") {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an invalid report kind");
  }
  if (report.status === "infeasible") {
    if (!Array.isArray(report.issues) || typeof report.finalCount !== "number") {
      throw backendFailure("INTERNAL", "Python synthesis engine returned invalid infeasibility diagnostics");
    }
    return input as EngineSynthesisInfeasibleReport;
  }
  if (report.status !== "success") {
    throw backendFailure("INTERNAL", "Python synthesis engine returned an unknown status");
  }
  const achieved = report.achieved;
  if (
    typeof report.sourceCount !== "number" ||
    typeof report.syntheticCount !== "number" ||
    typeof report.finalCount !== "number" ||
    typeof achieved !== "object" ||
    achieved === null ||
    typeof (achieved as Record<string, unknown>).mean !== "number" ||
    typeof (achieved as Record<string, unknown>).absoluteError !== "number" ||
    typeof (achieved as Record<string, unknown>).exact !== "boolean"
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
          rejectRun(
            backendFailure(
              "INTERNAL",
              `Python compute engine exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
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

export const createPythonEngine = ({ jobs, launch }: CreatePythonEngineOptions): PythonEngine => ({
  selftest: async (operationId, workDir) => {
    await runEngineProcess(jobs, launch, operationId, ["selftest", "--work-dir", workDir]);
    return parseSmokeReport(await readReport(join(workDir, "report.json")));
  },

  synthesize: async (operationId, jobPath, reportPath) => {
    await runEngineProcess(jobs, launch, operationId, ["synthesize", "--job", jobPath]);
    return parseSynthesisReport(await readReport(reportPath));
  },

  cancel: (operationId) => jobs.cancel(operationId),
});
