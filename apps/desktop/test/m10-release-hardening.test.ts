import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { backendFailure, normalizeBackendError } from "../electron/main/errors";

const repositoryFile = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const readRepositoryFile = (path: string): string => readFileSync(repositoryFile(path), "utf8");

describe("M10 release hardening", () => {
  it("keeps local verification outputs out of source control", () => {
    const ignored = readRepositoryFile(".gitignore").split(/\r?\n/);
    expect(ignored).toContain(".local-live/");
    expect(ignored).toContain(".local-desktop-packaged-smoke/");
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

  it("describes refresh-token storage as safeStorage-encrypted local state", () => {
    const privacy = readRepositoryFile("docs/release/PRIVACY_POLICY.md");
    const oauth = readRepositoryFile("docs/release/GOOGLE_OAUTH_VERIFICATION.md");
    for (const copy of [privacy, oauth]) {
      expect(copy).toContain("safeStorage");
      expect(copy).toContain("basic_text");
      expect(copy).not.toContain("stored in the OS secure credential store");
      expect(copy).not.toContain("stored in the operating system's secure credential store");
    }
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

  it("uses sanitized startup diagnostics instead of logging raw initialization errors", () => {
    const main = readRepositoryFile("apps/desktop/electron/main/index.ts");
    expect(main).toContain("const normalized = normalizeBackendError(error);");
    expect(main).toContain(
      'console.error("Failed to initialize Survey Synth:", normalized.code, normalized.message);',
    );
    expect(main).not.toContain('console.error("Failed to initialize Survey Synth:", error);');
  });

  it("provides package description metadata without inventing release authority", () => {
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      description?: string;
    };
    expect(packageJson.description?.trim().length).toBeGreaterThan(0);
  });

  it("fails packaging when a production dependency cannot be resolved", () => {
    const builder = JSON.parse(readRepositoryFile("apps/desktop/electron-builder.json")) as {
      allowMissingDependencies?: boolean;
    };
    expect(builder.allowMissingDependencies).toBe(false);
  });

  it("keeps Linux desktop window association aligned with the application id", () => {
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      desktopName?: string;
    };
    const builder = JSON.parse(readRepositoryFile("apps/desktop/electron-builder.json")) as {
      appId?: string;
      linux?: { syncDesktopName?: boolean };
    };
    expect(packageJson.desktopName).toBe(`${builder.appId}.desktop`);
    expect(builder.linux?.syncDesktopName).toBe(true);
  });
});
