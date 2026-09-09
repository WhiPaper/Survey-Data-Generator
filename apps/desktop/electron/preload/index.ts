import { contextBridge, ipcRenderer } from "electron";

import { createBeforeCloseRegistry, type BeforeCloseListener } from "./close-request-registry";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
const WINDOW_CLOSE_REQUEST_CHANNEL = "survey-synth:window-close-request";
const WINDOW_CLOSE_RESPONSE_CHANNEL = "survey-synth:window-close-response";
const CHART_COPY_CHANNEL = "survey-synth:chart-copy";
const CHART_SAVE_CHANNEL = "survey-synth:chart-save";

type BackendIpcResult = { ok: true; result: unknown } | { ok: false; error: unknown };

const backendCall = async (request: string): Promise<unknown> => {
  const response = (await ipcRenderer.invoke(BACKEND_CALL_CHANNEL, request)) as BackendIpcResult;
  if (response.ok) return response.result;
  throw response.error;
};

const beforeCloseRegistry = createBeforeCloseRegistry();

ipcRenderer.on(WINDOW_CLOSE_REQUEST_CHANNEL, () => {
  void beforeCloseRegistry
    .resolve()
    .then((canClose) => ipcRenderer.send(WINDOW_CLOSE_RESPONSE_CHANNEL, canClose));
});

const onBeforeClose = (listener: BeforeCloseListener): (() => void) =>
  beforeCloseRegistry.setListener(listener);

contextBridge.exposeInMainWorld("surveySynth", {
  backendCall,
  onBeforeClose,
  copyChart: (dataUrl: string) => ipcRenderer.invoke(CHART_COPY_CHANNEL, dataUrl) as Promise<void>,
  saveChart: (svg: string, filename: string) =>
    ipcRenderer.invoke(CHART_SAVE_CHANNEL, { svg, filename }) as Promise<"saved" | "cancelled">,
});
