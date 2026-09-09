import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, shell } from "electron";

import { loadGoogleOAuthConfig } from "./auth/config";
import { createElectronRefreshTokenStore } from "./auth/electron-credentials";
import { createGoogleProvider } from "./auth/google-provider";
import { createGoogleAuthService } from "./auth/service";
import { handleBackendCall, type BackendServices } from "./backend";
import { createPythonEngine, resolveEngineLaunch } from "./compute/python-engine";
import { normalizeBackendError } from "./errors";
import { createRunExportService } from "./export/service";
import { createCompositeService } from "./composites/service";
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
import { createWindowCloseGate } from "./window-close-gate";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
const WINDOW_CLOSE_REQUEST_CHANNEL = "survey-synth:window-close-request";
const WINDOW_CLOSE_RESPONSE_CHANNEL = "survey-synth:window-close-response";
const CHART_COPY_CHANNEL = "survey-synth:chart-copy";
const CHART_SAVE_CHANNEL = "survey-synth:chart-save";
const closeGates = new WeakMap<BrowserWindow, ReturnType<typeof createWindowCloseGate>>();
const developmentMode = !app.isPackaged;
const packagedSmoke = app.isPackaged && process.env.SURVEY_SYNTH_PACKAGED_SMOKE === "1";
const packagedSmokeUserData = process.env.SURVEY_SYNTH_PACKAGED_SMOKE_DIR?.trim();
if (packagedSmoke && packagedSmokeUserData) app.setPath("userData", packagedSmokeUserData);
// Electron otherwise may silently select Chromium's insecure basic_text backend on Linux.
// Force the Secret Service/libsecret backend before app readiness is reached.
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "gnome-libsecret");

let appDatabase: AppDatabase | null = null;
let backendServices: BackendServices = {};

if (developmentMode) {
  process.on("uncaughtException", (error) => console.error("uncaught_exception", error));
  process.on("unhandledRejection", (reason) => console.error("unhandled_rejection", reason));
}

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

  const closeGate = createWindowCloseGate();
  closeGates.set(window, closeGate);
  window.on("close", (event) => {
    if (window.webContents.isDestroyed()) return;
    const decision = closeGate.requestClose();
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "prevent_and_request") {
      window.webContents.send(WINDOW_CLOSE_REQUEST_CHANNEL);
    }
  });

  window.once("ready-to-show", () => window.show());
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

ipcMain.on(WINDOW_CLOSE_RESPONSE_CHANNEL, (event, canClose: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  const closeGate = closeGates.get(window);
  if (!closeGate) return;
  if (closeGate.resolve(canClose === true) && !window.isDestroyed()) window.close();
});

ipcMain.handle(BACKEND_CALL_CHANNEL, async (_event, serializedRequest: string) => {
  let method = "unknown";
  try {
    method = (JSON.parse(serializedRequest) as { method?: string }).method ?? method;
  } catch {
    // The request parser below reports malformed requests.
  }
  if (developmentMode) console.info("backend_call_started", { method });
  try {
    const response = {
      ok: true as const,
      result: await handleBackendCall(serializedRequest, backendServices),
    };
    if (developmentMode) console.info("backend_call_succeeded", { method });
    return response;
  } catch (error: unknown) {
    const normalized = normalizeBackendError(error, {
      exposeInternalDetails: developmentMode,
    });
    console.error("backend_call_failed", {
      method,
      errorCategory: normalized.code,
      errorMessage: normalized.message,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    if (developmentMode) {
      console.error("backend_call_failed_detail", error);
    }
    return { ok: false as const, error: normalized };
  }
});

ipcMain.handle(CHART_COPY_CHANNEL, async (_event, dataUrl: unknown) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Invalid chart image");
  }
  const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (png.length === 0 || png.length > 10_000_000) throw new Error("Invalid chart image");
  await clipboard.write([
    new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) }),
  ]);
});

ipcMain.handle(CHART_SAVE_CHANNEL, async (_event, input: unknown) => {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof (input as { svg?: unknown }).svg !== "string" ||
    typeof (input as { filename?: unknown }).filename !== "string"
  ) {
    throw new Error("Invalid chart export");
  }
  const { svg, filename } = input as { svg: string; filename: string };
  if (svg.length > 2_000_000 || filename.length > 120) throw new Error("Invalid chart export");
  const result = await dialog.showSaveDialog({
    title: "차트 저장",
    defaultPath: filename.endsWith(".svg") ? filename : `${filename}.svg`,
    filters: [{ name: "SVG image", extensions: ["svg"] }],
  });
  if (result.canceled || !result.filePath) return "cancelled" as const;
  await writeFile(result.filePath, svg, "utf8");
  return "saved" as const;
});

void app
  .whenReady()
  .then(async () => {
    const userDataPath = app.getPath("userData");
    appDatabase = openAppDatabase({
      filename: join(userDataPath, "survey-synth.sqlite"),
      migrationsFolder: join(app.getAppPath(), "drizzle"),
    });

    const refreshTokens = createElectronRefreshTokenStore(
      join(userDataPath, "credentials", "google-refresh-tokens.json"),
    );
    const googleProvider = createGoogleProvider({
      getConfig: () => loadGoogleOAuthConfig({ appPath: app.getAppPath() }),
      openExternal: (url) => shell.openExternal(url),
    });
    const auth = createGoogleAuthService({
      db: appDatabase.db,
      refreshTokens,
      google: googleProvider,
    });
    const jobs = createJobRegistry({ development: developmentMode });
    const googleForms = createGoogleFormsClient({ auth });
    const forms = createFormsService({ auth, google: googleForms, db: appDatabase.db, jobs });
    const engine = createPythonEngine({
      jobs,
      development: !app.isPackaged,
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
    const targets = createTargetService(appDatabase.db, synthesis);
    const composites = createCompositeService(appDatabase.db, synthesis, targets);

    backendServices = {
      auth,
      forms,
      projects: createProjectService({ db: appDatabase.db }),
      valueGroups: createValueGroupService(appDatabase.db),
      targets,
      synthesis,
      runExports,
      composites,
      pickRunExportDestination: async ({ format }) => {
        const isCsv = format === "csv";
        const result = await dialog.showSaveDialog({
          title: isCsv ? "CSV 내보내기" : "XLSX 내보내기",
          defaultPath: `survey-synth-result.${format}`,
          filters: [
            isCsv
              ? { name: "CSV", extensions: ["csv"] }
              : { name: "Excel Workbook", extensions: ["xlsx"] },
          ],
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
  })
  .catch((error: unknown) => {
    const normalized = normalizeBackendError(error);
    console.error("Failed to initialize Survey Synth:", normalized.code, normalized.message);
    if (developmentMode) {
      console.error("Failed to initialize Survey Synth (detail):", error);
    }
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
