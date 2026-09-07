import { contextBridge, ipcRenderer } from "electron";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";
const WINDOW_CLOSE_REQUEST_CHANNEL = "survey-synth:window-close-request";
const WINDOW_CLOSE_RESPONSE_CHANNEL = "survey-synth:window-close-response";

type BackendIpcResult = { ok: true; result: unknown } | { ok: false; error: unknown };

const backendCall = async (request: string): Promise<unknown> => {
  const response = (await ipcRenderer.invoke(BACKEND_CALL_CHANNEL, request)) as BackendIpcResult;
  if (response.ok) return response.result;
  throw response.error;
};

const onBeforeClose = (listener: () => boolean | Promise<boolean>): (() => void) => {
  const handler = (): void => {
    void Promise.resolve()
      .then(listener)
      .then((canClose) => ipcRenderer.send(WINDOW_CLOSE_RESPONSE_CHANNEL, canClose === true))
      .catch(() => ipcRenderer.send(WINDOW_CLOSE_RESPONSE_CHANNEL, false));
  };
  ipcRenderer.on(WINDOW_CLOSE_REQUEST_CHANNEL, handler);
  return () => ipcRenderer.removeListener(WINDOW_CLOSE_REQUEST_CHANNEL, handler);
};

contextBridge.exposeInMainWorld("surveySynth", { backendCall, onBeforeClose });
