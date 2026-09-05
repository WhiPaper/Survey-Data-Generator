import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPythonEngine,
  resolveEngineLaunch,
} from "../electron/main/compute/python-engine";
import { createJobRegistry } from "../electron/main/jobs";

const fixture = fileURLToPath(new URL("./fixtures/fake-engine.cjs", import.meta.url));
const directories: string[] = [];

const workDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "survey-synth-engine-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("Python compute boundary", () => {
  it("resolves development and packaged engine launches without a daemon", () => {
    expect(
      resolveEngineLaunch({
        isPackaged: false,
        appPath: "C:/repo/apps/desktop",
        resourcesPath: "C:/resources",
        platform: "win32",
        env: {},
      }),
    ).toMatchObject({ command: "python" });

    expect(
      resolveEngineLaunch({
        isPackaged: true,
        appPath: "C:/app",
        resourcesPath: "C:/resources",
        platform: "win32",
        env: {},
      }).command.replaceAll("\\", "/"),
    ).toBe("C:/resources/engine/survey-synth-engine.exe");
  });

  it("spawns one job process and parses report.json", async () => {
    const engine = createPythonEngine({
      jobs: createJobRegistry(),
      launch: { command: process.execPath, argsPrefix: [fixture] },
    });

    await expect(engine.selftest("engine-smoke", workDir())).resolves.toMatchObject({
      status: "ok",
      kind: "smoke",
      rowCount: 2,
      capabilities: { scipyMilp: true, sdvGaussianCopula: true },
    });
  });

  it("parses conditional share counts from synthesis report.json", async () => {
    const directory = workDir();
    const jobPath = join(directory, "job.json");
    const reportPath = join(directory, "report.json");
    writeFileSync(
      jobPath,
      JSON.stringify({
        protocol_version: 1,
        kind: "synthesize",
        source_parquet: "source.parquet",
        result_parquet: "result.parquet",
        report_json: "report.json",
        final_count: 4,
        mean_target: { column: "target_score", value: 4.5, minimum: 1, maximum: 5 },
        conditional_share_targets: [],
        seed: 42,
      }),
    );
    const engine = createPythonEngine({
      jobs: createJobRegistry(),
      launch: { command: process.execPath, argsPrefix: [fixture] },
    });

    await expect(engine.synthesize("engine-m6", jobPath, reportPath)).resolves.toMatchObject({
      status: "success",
      achieved: {
        conditionalShares: [
          {
            share: 0.75,
            numeratorCount: 3,
            denominatorCount: 4,
            exact: true,
          },
        ],
      },
    });
  });

  it("kills the child process when the job is cancelled", async () => {
    const engine = createPythonEngine({
      jobs: createJobRegistry(),
      launch: { command: process.execPath, argsPrefix: [fixture, "hang"] },
    });
    const pending = engine.selftest("engine-hang", workDir());

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.cancel("engine-hang")).toBe(true);
    await expect(pending).rejects.toMatchObject({
      backendError: { code: "JOB_CANCELLED" },
    });
  });

  it("surfaces worker exit failures as structured backend errors", async () => {
    const engine = createPythonEngine({
      jobs: createJobRegistry(),
      launch: { command: process.execPath, argsPrefix: [fixture, "fail"] },
    });

    await expect(engine.selftest("engine-fail", workDir())).rejects.toMatchObject({
      backendError: {
        code: "INTERNAL",
        message: expect.stringContaining("fake engine failure"),
      },
    });
  });
});
