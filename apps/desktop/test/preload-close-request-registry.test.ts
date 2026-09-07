import { describe, expect, it } from "vitest";

import { createBeforeCloseRegistry } from "../electron/preload/close-request-registry";

describe("preload close request registry", () => {
  it("allows close immediately before a renderer listener is registered", async () => {
    const registry = createBeforeCloseRegistry();
    await expect(registry.resolve()).resolves.toBe(true);
  });

  it("awaits the active renderer listener and respects its decision", async () => {
    const registry = createBeforeCloseRegistry();
    let release: ((value: boolean) => void) | null = null;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    registry.setListener(() => pending);

    const result = registry.resolve();
    release?.(false);
    await expect(result).resolves.toBe(false);
  });

  it("treats listener errors as a close rejection", async () => {
    const registry = createBeforeCloseRegistry();
    registry.setListener(() => {
      throw new Error("save failed");
    });
    await expect(registry.resolve()).resolves.toBe(false);
  });

  it("does not let an older cleanup remove a newer listener", async () => {
    const registry = createBeforeCloseRegistry();
    const cleanupFirst = registry.setListener(() => false);
    registry.setListener(() => true);
    cleanupFirst();
    await expect(registry.resolve()).resolves.toBe(true);
  });
});
