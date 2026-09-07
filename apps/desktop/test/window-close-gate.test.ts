import { describe, expect, it } from "vitest";

import { createWindowCloseGate } from "../electron/main/window-close-gate";

describe("desktop window close gate", () => {
  it("requests one renderer flush and closes only after approval", () => {
    const gate = createWindowCloseGate();
    expect(gate.requestClose()).toBe("prevent_and_request");
    expect(gate.requestClose()).toBe("prevent");
    expect(gate.resolve(true)).toBe(true);
    expect(gate.requestClose()).toBe("allow");
    expect(gate.requestClose()).toBe("prevent_and_request");
  });

  it("keeps the window open when the renderer reports a save failure", () => {
    const gate = createWindowCloseGate();
    expect(gate.requestClose()).toBe("prevent_and_request");
    expect(gate.resolve(false)).toBe(false);
    expect(gate.requestClose()).toBe("prevent_and_request");
  });
});
