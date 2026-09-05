export {};

declare global {
  interface Window {
    surveySynth: {
      backendCall(request: string): Promise<unknown>;
    };
  }
}
