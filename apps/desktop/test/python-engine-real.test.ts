import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createPythonEngine,
  resolveEngineLaunch,
} from "../electron/main/compute/python-engine";
import { createJobRegistry } from "../electron/main/jobs";

const desktopPath = fileURLToPath(new URL("..", import.meta.url));

describe("real Python compute integration", () => {
  it("spawns the development Python 3.12 engine and round-trips Parquet", async () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-synth-real-engine-"));
    try {
      const engine = createPythonEngine({
        jobs: createJobRegistry(),
        launch: resolveEngineLaunch({
          isPackaged: false,
          appPath: desktopPath,
          resourcesPath: "",
        }),
      });

      await expect(engine.selftest("real-engine-smoke", directory)).resolves.toMatchObject({
        status: "ok",
        kind: "smoke",
        rowCount: 2,
        columnCount: 3,
        capabilities: {
          parquet: true,
          sdvGaussianCopula: true,
          scipyMilp: true,
          sdmetricsQualityReport: true,
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
