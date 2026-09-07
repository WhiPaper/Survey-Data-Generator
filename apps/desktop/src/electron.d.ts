export {};

declare global {
  interface Window {
    surveySynth: {
      backendCall(request: string): Promise<unknown>;
      onBeforeClose(listener: () => boolean | Promise<boolean>): () => void;
    };
  }
}
