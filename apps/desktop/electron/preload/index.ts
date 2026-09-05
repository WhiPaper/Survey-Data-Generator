import { contextBridge, ipcRenderer } from "electron";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";

type BackendIpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: unknown };

const backendCall = async (request: string): Promise<unknown> => {
  const response = (await ipcRenderer.invoke(BACKEND_CALL_CHANNEL, request)) as BackendIpcResult;
  if (response.ok) return response.result;
  throw response.error;
};

contextBridge.exposeInMainWorld("surveySynth", { backendCall });
