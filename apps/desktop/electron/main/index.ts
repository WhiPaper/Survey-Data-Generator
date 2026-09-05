import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { handleBackendCall } from "./backend";
import { openAppDatabase, type AppDatabase } from "./persistence/database";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
let appDatabase: AppDatabase | null = null;

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

ipcMain.handle(BACKEND_CALL_CHANNEL, (_event, serializedRequest: string) =>
  handleBackendCall(serializedRequest),
);

void app
  .whenReady()
  .then(() => {
    appDatabase = openAppDatabase({
      filename: join(app.getPath("userData"), "survey-synth.sqlite"),
      migrationsFolder: join(app.getAppPath(), "drizzle"),
    });

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
  appDatabase?.close();
  appDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
