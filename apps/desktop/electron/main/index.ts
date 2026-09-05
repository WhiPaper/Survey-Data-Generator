import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";
import { parseRpcRequest } from "@survey-synth/contracts";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";

const handleBackendCall = async (serializedRequest: string): Promise<unknown> => {
  const request = parseRpcRequest(JSON.parse(serializedRequest) as unknown);

  switch (request.method) {
    case "system.ping":
      return { ok: true, message: "pong" };
    case "session.get":
      return null;
    default:
      throw new Error(`Backend method is not implemented in the Electron v2 shell: ${request.method}`);
  }
};

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

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
