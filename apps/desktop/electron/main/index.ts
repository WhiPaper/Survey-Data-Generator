import { join } from "node:path";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import { handleBackendCall, type BackendServices } from "./backend";
import { loadGoogleOAuthConfig } from "./auth/config";
import { createElectronRefreshTokenStore } from "./auth/electron-credentials";
import { createGoogleProvider } from "./auth/google-provider";
import { createGoogleAuthService } from "./auth/service";
import { normalizeBackendError } from "./errors";
import { openAppDatabase, type AppDatabase } from "./persistence/database";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
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
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
};

ipcMain.handle(BACKEND_CALL_CHANNEL, async (_event, serializedRequest: string) => {
  try {
    return {
      ok: true as const,
      result: await handleBackendCall(serializedRequest, backendServices),
    };
  } catch (error: unknown) {
    return {
      ok: false as const,
      error: normalizeBackendError(error),
    };
  }
});

void app
  .whenReady()
  .then(() => {
    const userDataPath = app.getPath("userData");
    appDatabase = openAppDatabase({
      filename: join(userDataPath, "survey-synth.sqlite"),
      migrationsFolder: join(app.getAppPath(), "drizzle"),
    });

    const refreshTokens = createElectronRefreshTokenStore(
      join(userDataPath, "credentials", "google-refresh-tokens.json"),
    );
    const google = createGoogleProvider({
      getConfig: () => loadGoogleOAuthConfig({ appPath: app.getAppPath() }),
      openExternal: (url) => shell.openExternal(url),
    });
    backendServices = {
      auth: createGoogleAuthService({
        db: appDatabase.db,
        refreshTokens,
        google,
      }),
    };

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize Survey Synth:", error);
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
