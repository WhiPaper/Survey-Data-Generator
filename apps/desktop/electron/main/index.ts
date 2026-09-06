import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { loadGoogleOAuthConfig } from "./auth/config";
import { createElectronRefreshTokenStore } from "./auth/electron-credentials";
import { createGoogleProvider } from "./auth/google-provider";
import { createGoogleAuthService } from "./auth/service";
import { handleBackendCall, type BackendServices } from "./backend";
import { createPythonEngine, resolveEngineLaunch } from "./compute/python-engine";
import { normalizeBackendError } from "./errors";
import { createRunExportService } from "./export/service";
import { createGoogleFormsClient } from "./forms/google-client";
import { createFormsService } from "./forms/service";
import { createJobRegistry } from "./jobs";
import { runPackagedSmoke } from "./packaged-smoke";
import { openAppDatabase, type AppDatabase } from "./persistence/database";
import { createProjectService } from "./projects/service";
import { createSynthesisService } from "./synthesis/service";
import { createTargetService } from "./targets/service";
import { schedulePrivateGitHubUpdateCheck } from "./updater/github-release-updater";
import { createValueGroupService } from "./value-groups/service";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
const packagedSmoke = app.isPackaged && process.env.SURVEY_SYNTH_PACKAGED_SMOKE === "1";
const packagedSmokeUserData = process.env.SURVEY_SYNTH_PACKAGED_SMOKE_DIR?.trim();
if (packagedSmoke && packagedSmokeUserData) app.setPath("userData", packagedSmokeUserData);

let appDatabase: AppDatabase | null = null;
let backendServices: BackendServices = {};

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

ipcMain.handle(BACKEND_CALL_CHANNEL, async (_event, serializedRequest: string) => {
  try {
    return { ok: true as const, result: await handleBackendCall(serializedRequest, backendServices) };
  } catch (error: unknown) {
    return { ok: false as const, error: normalizeBackendError(error) };
  }
});

void app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  appDatabase = openAppDatabase({
    filename: join(userDataPath, "survey-synth.sqlite"),
    migrationsFolder: join(app.getAppPath(), "drizzle"),
  });

  const refreshTokens = createElectronRefreshTokenStore(join(userDataPath, "credentials", "google-refresh-tokens.json"));
  const googleProvider = createGoogleProvider({
    getConfig: () => loadGoogleOAuthConfig({ appPath: app.getAppPath() }),
    openExternal: (url) => shell.openExternal(url),
  });
  const auth = createGoogleAuthService({ db: appDatabase.db, refreshTokens, google: googleProvider });
  const jobs = createJobRegistry();
  const googleForms = createGoogleFormsClient({ auth });
  const forms = createFormsService({ auth, google: googleForms, db: appDatabase.db, jobs });
  const engine = createPythonEngine({
    jobs,
    launch: resolveEngineLaunch({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
  });
  const synthesis = createSynthesisService({
    db: appDatabase.db,
    engine,
    workRoot: join(userDataPath, "compute-jobs"),
  });
  const runExports = createRunExportService(appDatabase.db);

  backendServices = {
    auth,
    forms,
    projects: createProjectService({ db: appDatabase.db }),
    valueGroups: createValueGroupService(appDatabase.db),
    targets: createTargetService(appDatabase.db, synthesis),
    synthesis,
    runExports,
    pickRunExportDestination: async ({ format }) => {
      const isCsv = format === "csv";
      const result = await dialog.showSaveDialog({
        title: isCsv ? "CSV 내보내기" : "XLSX 내보내기",
        defaultPath: `survey-synth-result.${format}`,
        filters: [isCsv ? { name: "CSV", extensions: ["csv"] } : { name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  };

  if (packagedSmoke) {
    await runPackagedSmoke({
      appPath: app.getAppPath(),
      database: appDatabase,
      engine,
      forms,
      workRoot: join(userDataPath, "packaged-smoke"),
    });
    console.log("PACKAGED_SMOKE_OK");
    app.quit();
    return;
  }

  createWindow();
  schedulePrivateGitHubUpdateCheck();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  const normalized = normalizeBackendError(error);
  console.error("Failed to initialize Survey Synth:", normalized.code, normalized.message);
  app.quit();
});

app.on("will-quit", () => {
  backendServices = {};
  appDatabase?.close();
  appDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
