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

  it("keeps private GitHub update access in packaged Electron Main only", () => {
    const config = readRepositoryFile("apps/desktop/electron.vite.config.ts");
    const updater = readRepositoryFile(
      "apps/desktop/electron/main/updater/github-release-updater.ts",
    );
    const workflow = readRepositoryFile(".github/workflows/release.yml");
    const builder = JSON.parse(readRepositoryFile("apps/desktop/electron-builder.json")) as {
      nsis?: { perMachine?: boolean };
    };
    const preloadOffset = config.indexOf("preload:");
    const rendererOffset = config.indexOf("renderer:");
    const updateTokenDefine = config.indexOf("__SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__");

    expect(updateTokenDefine).toBeGreaterThanOrEqual(0);
    expect(updateTokenDefine).toBeLessThan(preloadOffset);
    expect(config.slice(rendererOffset)).not.toContain("__SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__");
    expect(updater).toContain('const UPDATE_OWNER = "WhiPaper";');
    expect(updater).toContain('const UPDATE_REPOSITORY = "Survey-Data-Generator";');
    expect(updater).toContain("Authorization: `Bearer ${token}`");
    expect(updater).toContain("digest?.trim().toLowerCase()");
    expect(updater).toContain('["--updated", "/S", "--force-run"]');
    expect(updater).toContain("process.env.APPIMAGE?.trim()");
    expect(updater).toContain("/\\.AppImage$/i");
    expect(updater).toContain('"/bin/sh"');
    expect(updater).not.toContain("process.env.GH_TOKEN");
    expect(updater).not.toContain("process.env.GITHUB_TOKEN");
    expect(workflow).toContain("Require packaged build credentials");
    expect(workflow).toContain("secrets.SURVEY_SYNTH_UPDATE_GITHUB_TOKEN");
    expect(workflow).toContain("Build Electron app with packaged credentials");
    expect(workflow).toContain("if: ${{ inputs.publish_release }}");
    expect(workflow).toContain("contents: write");
    expect(builder.nsis?.perMachine).toBe(false);
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
    expect(
      normalizeBackendError(new Error("engine exploded"), { exposeInternalDetails: true }),
    ).toMatchObject({
      code: "INTERNAL",
      message: "engine exploded",
      details: { stack: expect.any(String) },
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

  it("declares the renderer build plugin used by the Electron Vite config", () => {
    const config = readRepositoryFile("apps/desktop/electron.vite.config.ts");
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      devDependencies?: Record<string, string>;
    };
    expect(config).toContain('from "@vitejs/plugin-react"');
    expect(packageJson.devDependencies?.["@vitejs/plugin-react"]).toBe("^5.0.2");
  });

  it("injects Google OAuth build credentials into Electron Main only", () => {
    const config = readRepositoryFile("apps/desktop/electron.vite.config.ts");
    const authConfig = readRepositoryFile("apps/desktop/electron/main/auth/config.ts");
    const workflow = readRepositoryFile(".github/workflows/release.yml");
    const preloadOffset = config.indexOf("preload:");
    const rendererOffset = config.indexOf("renderer:");
    const clientIdDefine = config.indexOf("__SURVEY_SYNTH_GOOGLE_CLIENT_ID__");
    const clientSecretDefine = config.indexOf("__SURVEY_SYNTH_GOOGLE_CLIENT_SECRET__");

    expect(clientIdDefine).toBeGreaterThanOrEqual(0);
    expect(clientSecretDefine).toBeGreaterThanOrEqual(0);
    expect(clientIdDefine).toBeLessThan(preloadOffset);
    expect(clientSecretDefine).toBeLessThan(preloadOffset);
    expect(config.slice(rendererOffset)).not.toContain("__SURVEY_SYNTH_GOOGLE_CLIENT_ID__");
    expect(config.slice(rendererOffset)).not.toContain("__SURVEY_SYNTH_GOOGLE_CLIENT_SECRET__");
    expect(authConfig).toContain("buildClientId");
    expect(authConfig).toContain("buildClientSecret");
    expect(workflow).toContain("Require packaged build credentials");
    expect(workflow).toContain("secrets.SURVEY_SYNTH_GOOGLE_CLIENT_ID");
    expect(workflow).toContain("secrets.SURVEY_SYNTH_GOOGLE_CLIENT_SECRET");
  });

  it("provides package description metadata without inventing release authority", () => {
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      description?: string;
    };
    expect(packageJson.description?.trim().length).toBeGreaterThan(0);
  });

  it("keeps pinned electron-builder packaging schema-compatible and disables implicit publishing", () => {
    const builder = JSON.parse(readRepositoryFile("apps/desktop/electron-builder.json")) as {
      allowMissingDependencies?: unknown;
    };
    const rootPackage = JSON.parse(readRepositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readRepositoryFile(".github/workflows/release.yml");

    expect(builder.allowMissingDependencies).toBeUndefined();
    expect(rootPackage.scripts?.["package:desktop:dir"]).toContain("--publish never");
    expect(rootPackage.scripts?.["package:desktop:artifact"]).toContain("--publish never");
    expect(workflow).toContain("Shorten pnpm dlx cache path on Windows");
    expect(workflow).toContain('pnpm config set cache-dir "${{ runner.temp }}\\pnpm-cache"');

    const shortDlxCache = workflow.indexOf("Shorten pnpm dlx cache path on Windows");
    const packageDir = workflow.indexOf("pnpm run package:desktop:dir");
    const packagedSmoke = workflow.indexOf("pnpm run package:desktop:smoke");
    expect(shortDlxCache).toBeGreaterThanOrEqual(0);
    expect(packageDir).toBeGreaterThan(shortDlxCache);
    expect(packagedSmoke).toBeGreaterThan(packageDir);
  });

  it("keeps unused neural and CUDA stacks out of the packaged Gaussian engine", () => {
    const spec = readRepositoryFile("engine/survey-synth-engine.spec");
    const generator = readRepositoryFile("engine/generate.py");
    const requirements = readRepositoryFile("engine/requirements.txt");

    for (const moduleName of ["ctgan", "deepecho", "torch", "triton", "nvidia", "cuda"]) {
      expect(spec).toContain(`"${moduleName}"`);
    }
    expect(spec).toContain("excludes=unused_neural_modules");
    expect(generator).toContain("GaussianCopulaSynthesizer");
    expect(generator).not.toContain("CTGANSynthesizer");
    expect(generator).not.toContain("TVAESynthesizer");
    expect(generator).not.toContain("PARSynthesizer");
    expect(requirements).toContain("sdv==1.38.0");
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
