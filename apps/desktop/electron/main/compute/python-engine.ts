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
  cancel(operationId: string): boolean;
}

const appendCaptured = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString("utf8");
  return next.length <= MAX_CAPTURED_OUTPUT ? next : next.slice(-MAX_CAPTURED_OUTPUT);
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

export const createPythonEngine = ({ jobs, launch }: CreatePythonEngineOptions): PythonEngine => {
  const runSelftest = async (operationId: string, workDir: string): Promise<EngineSmokeReport> => {
    let child: ChildProcess | null = null;
    const signal = jobs.start(operationId, () => child?.kill());

    try {
      await new Promise<void>((resolveRun, rejectRun) => {
        let stderr = "";

        try {
          child = spawn(
            launch.command,
            [...launch.argsPrefix, "selftest", "--work-dir", workDir],
            {
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
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

      const reportPath = join(workDir, "report.json");
      let raw: string;
      try {
        raw = await readFile(reportPath, "utf8");
      } catch {
        throw backendFailure("INTERNAL", "Python compute engine did not produce report.json");
      }
      try {
        return parseSmokeReport(JSON.parse(raw) as unknown);
      } catch (error: unknown) {
        if (error instanceof SyntaxError) {
          throw backendFailure("INTERNAL", "Python compute engine produced invalid report JSON");
        }
        throw error;
      }
    } finally {
      jobs.finish(operationId);
    }
  };

  return {
    selftest: runSelftest,
    cancel: (operationId) => jobs.cancel(operationId),
  };
};
