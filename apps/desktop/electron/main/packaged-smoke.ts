import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { FormId } from "@survey-synth/contracts";

import { loadGoogleOAuthConfig } from "./auth/config";
import { createGoogleProvider } from "./auth/google-provider";
import type { PythonEngine } from "./compute/python-engine";
import { BackendFailure } from "./errors";
import { writeCsv } from "./export/csv";
import type { LogicalExportTable } from "./export/logical-table";
import { writeXlsx } from "./export/xlsx";
import type { FormsService } from "./forms/service";
import type { AppDatabase } from "./persistence/database";
import { createProject, getProject } from "./persistence/store";

export type PackagedSmokeOptions = {
  appPath: string;
  database: AppDatabase;
  engine: PythonEngine;
  forms: FormsService;
  workRoot: string;
};

const expectBackendFailure = (error: unknown, code: string): void => {
  if (!(error instanceof BackendFailure) || error.backendError.code !== code) {
    throw error;
  }
};

const verifyDatabase = (database: AppDatabase): void => {
  createProject(database.db, {
    id: "packaged-smoke-project",
    name: "Packaged smoke project",
    googleFormId: "packaged-smoke-form",
    nowMs: 1,
  });
  const project = getProject(database.db, "packaged-smoke-project");
  if (!project || project.name !== "Packaged smoke project") {
    throw new Error("Packaged SQLite read/write smoke failed");
  }
};

const verifyGoogleOAuthLoopback = async (appPath: string): Promise<void> => {
  let openedAuthorizationUrl = false;
  const google = createGoogleProvider({
    getConfig: () => loadGoogleOAuthConfig({ appPath }),
    openExternal: async (url) => {
      const authorizationUrl = new URL(url);
      const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
      const state = authorizationUrl.searchParams.get("state");
      const codeChallenge = authorizationUrl.searchParams.get("code_challenge");
      if (
        !redirectUri?.startsWith("http://127.0.0.1:") ||
        !state ||
        !codeChallenge
      ) {
        throw new Error("Packaged Google OAuth URL/loopback setup was invalid");
      }

      openedAuthorizationUrl = true;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("error", "access_denied");
      const response = await fetch(callbackUrl);
      if (response.status !== 400) {
        throw new Error(`Packaged Google OAuth callback returned ${response.status}`);
      }
    },
    timeoutMs: 5_000,
  });

  try {
    await google.authorize("login");
    throw new Error("Packaged Google OAuth cancellation smoke unexpectedly succeeded");
  } catch (error: unknown) {
    expectBackendFailure(error, "VALIDATION_FAILED");
  }

  if (!openedAuthorizationUrl) {
    throw new Error("Packaged Google OAuth authorization URL was not generated");
  }
};

const verifyFormsImportBoundary = async (forms: FormsService): Promise<void> => {
  try {
    await forms.importForm({ formId: "packaged-smoke-form" as FormId });
    throw new Error("Packaged Forms import smoke unexpectedly succeeded without an account");
  } catch (error: unknown) {
    expectBackendFailure(error, "UNAUTHENTICATED");
  }
};

const verifyEngine = async (engine: PythonEngine, workRoot: string): Promise<void> => {
  const report = await engine.selftest("packaged-smoke-engine", join(workRoot, "engine"));
  if (
    !report.capabilities.parquet ||
    !report.capabilities.sdvGaussianCopula ||
    !report.capabilities.scipyMilp ||
    !report.capabilities.sdmetricsQualityReport
  ) {
    throw new Error("Packaged Python engine capabilities were incomplete");
  }

  const cancellation = engine.selftest(
    "packaged-smoke-engine-cancel",
    join(workRoot, "engine-cancel"),
  );
  if (!engine.cancel("packaged-smoke-engine-cancel")) {
    throw new Error("Packaged Python engine cancellation was not registered");
  }
  try {
    await cancellation;
    throw new Error("Packaged Python engine completed before cancellation");
  } catch (error: unknown) {
    expectBackendFailure(error, "JOB_CANCELLED");
  }
};

const verifyExports = async (workRoot: string): Promise<void> => {
  const table: LogicalExportTable = {
    columns: [
      { key: "memo", header: "메모" },
      { key: "score", header: "점수" },
    ],
    rows: [
      {
        cells: [
          { kind: "text", value: "=1+1\n한국어" },
          { kind: "number", value: 4 },
        ],
      },
    ],
  };
  const csvPath = join(workRoot, "result.csv");
  const xlsxPath = join(workRoot, "result.xlsx");
  await writeCsv(table, csvPath);
  await writeXlsx(table, xlsxPath);

  const csv = await readFile(csvPath, "utf8");
  if (!csv.startsWith("\uFEFF") || !csv.includes("'=1+1")) {
    throw new Error("Packaged CSV export smoke failed");
  }
  if ((await stat(xlsxPath)).size <= 0) {
    throw new Error("Packaged XLSX export smoke failed");
  }
};

export const runPackagedSmoke = async ({
  appPath,
  database,
  engine,
  forms,
  workRoot,
}: PackagedSmokeOptions): Promise<void> => {
  verifyDatabase(database);
  await verifyGoogleOAuthLoopback(appPath);
  await verifyFormsImportBoundary(forms);
  await verifyEngine(engine, workRoot);
  await verifyExports(workRoot);
};
