import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type Target = { target: string; arch: string[] };
type PackagingConfig = {
  electronVersion: string;
  files: string[];
  extraResources: Array<{ from: string; to: string; filter: string[] }>;
  win: { target: Target[] };
  linux: { target: Target[] };
};

const configPath = fileURLToPath(new URL("../electron-builder.json", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8")) as PackagingConfig;

describe("M9 Electron packaging config", () => {
  it("packages the native Python engine into the resources path used by Electron Main", () => {
    expect(config.electronVersion).toBe("44.2.0");
    expect(config.files).toEqual(expect.arrayContaining(["out/**/*", "drizzle/**/*"]));
    expect(config.extraResources).toContainEqual({
      from: "../../engine/dist",
      to: "engine",
      filter: ["survey-synth-engine*"],
    });
  });

  it("targets only Windows x64 and Linux x64 for the initial release", () => {
    expect(config.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(config.linux.target).toEqual([{ target: "AppImage", arch: ["x64"] }]);
  });
});
