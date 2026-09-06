import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { backendFailure, normalizeBackendError } from "../electron/main/errors";

const repositoryFile = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const readRepositoryFile = (path: string): string => readFileSync(repositoryFile(path), "utf8");

describe("M10 release hardening", () => {
  it("keeps live Google verification state out of source control", () => {
    expect(readRepositoryFile(".gitignore").split(/\r?\n/)).toContain(".local-live/");
    expect(existsSync(repositoryFile(".local-live/google-accounts.json"))).toBe(false);
  });

  it("does not retain updater publishing plumbing before an updater decision", () => {
    expect(existsSync(repositoryFile("scripts/create-github-updater-manifest.mjs"))).toBe(false);
  });

  it("keeps release contact copy free of unavailable or placeholder support channels", () => {
    const support = readRepositoryFile("docs/release/SUPPORT.md");
    const privacy = readRepositoryFile("docs/release/PRIVACY_POLICY.md");
    expect(support).not.toContain("/discussions");
    expect(support).not.toContain("@surveysynth.local");
    expect(privacy).not.toContain("@surveysynth.local");
  });

  it("does not expose internal error details across the Electron IPC boundary", () => {
    expect(normalizeBackendError(backendFailure("INTERNAL", "secret /local/path"))).toEqual({
      code: "INTERNAL",
      message: "Unexpected backend error",
      recoverable: true,
    });
    expect(normalizeBackendError(new Error("secret /local/path"))).toEqual({
      code: "INTERNAL",
      message: "Unexpected backend error",
      recoverable: true,
    });
  });

  it("provides package description metadata without inventing release authority", () => {
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      description?: string;
    };
    expect(packageJson.description?.trim().length).toBeGreaterThan(0);
  });
});
