export {};

declare global {
  interface Window {
    surveySynth: {
      backendCall(request: string): Promise<unknown>;
      onBeforeClose(listener: () => boolean | Promise<boolean>): () => void;
      copyChart(dataUrl: string): Promise<void>;
      saveChart(svg: string, filename: string): Promise<"saved" | "cancelled">;
    };
  }
}
