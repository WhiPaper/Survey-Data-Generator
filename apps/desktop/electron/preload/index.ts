import { contextBridge, ipcRenderer } from "electron";

const BACKEND_CALL_CHANNEL = "survey-synth:backend-call";

contextBridge.exposeInMainWorld("surveySynth", {
  backendCall: (request: string): Promise<unknown> => ipcRenderer.invoke(BACKEND_CALL_CHANNEL, request),
});
