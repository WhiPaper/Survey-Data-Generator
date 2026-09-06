import { describe, expect, it } from "vitest";

import { isNewerStableVersion } from "../electron/main/updater/version";

describe("private GitHub updater version comparison", () => {
  it("accepts only newer stable semantic versions", () => {
    expect(isNewerStableVersion("v0.1.1", "0.1.0")).toBe(true);
    expect(isNewerStableVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerStableVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerStableVersion("0.0.9", "0.1.0")).toBe(false);
    expect(isNewerStableVersion("v0.2.0-beta.1", "0.1.0")).toBe(false);
    expect(isNewerStableVersion("latest", "0.1.0")).toBe(false);
  });
});
