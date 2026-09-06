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

  it("declares the renderer build plugin used by the Electron Vite config", () => {
    const config = readRepositoryFile("apps/desktop/electron.vite.config.ts");
    const packageJson = JSON.parse(readRepositoryFile("apps/desktop/package.json")) as {
      devDependencies?: Record<string, string>;
    };
    expect(config).toContain('from "@vitejs/plugin-react"');
    expect(packageJson.devDependencies?.["@vitejs/plugin-react"]).toBe("^5.0.2");
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
    const gaussianRequirements = readRepositoryFile("engine/requirements-gaussian.txt");
    const sdvRequirements = readRepositoryFile("engine/requirements-sdv.txt");
    const dependencyCheck = readRepositoryFile("engine/check_packaged_dependencies.py");
    const workflow = readRepositoryFile(".github/workflows/release.yml");
    const rootPackage = JSON.parse(readRepositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    for (const moduleName of ["ctgan", "deepecho", "torch", "triton", "nvidia", "cuda"]) {
      expect(spec).toContain(`"${moduleName}"`);
    }
    expect(spec).toContain("excludes=unused_neural_modules");
    expect(generator).toContain("GaussianCopulaSynthesizer");
    expect(generator).not.toContain("CTGANSynthesizer");
    expect(generator).not.toContain("TVAESynthesizer");
    expect(generator).not.toContain("PARSynthesizer");
    expect(requirements).toContain("sdv==1.38.0");
    expect(sdvRequirements).toContain("sdv==1.38.0");

    for (const forbidden of ["ctgan", "deepecho", "torch", "triton", "nvidia-", "cuda-"]) {
      expect(gaussianRequirements).not.toContain(forbidden);
    }
    for (const required of [
      "boto3",
      "botocore",
      "cloudpickle",
      "graphviz",
      "numpy",
      "pandas",
      "tqdm",
      "copulas",
      "rdt",
      "sdmetrics",
      "platformdirs",
      "pyyaml",
    ]) {
      expect(gaussianRequirements).toContain(required);
    }

    expect(rootPackage.scripts?.["engine:install:packaged"]).toContain(
      "engine/requirements-gaussian.txt",
    );
    expect(rootPackage.scripts?.["engine:install:packaged"]).toContain("--no-deps");
    expect(rootPackage.scripts?.["engine:check:packaged-deps"]).toContain(
      "engine/check_packaged_dependencies.py",
    );
    expect(workflow).toContain("pnpm run engine:install:packaged");
    expect(workflow).toContain("pnpm run engine:check:packaged-deps");
    expect(workflow).toContain("engine/requirements-gaussian.txt");
    expect(workflow).toContain("engine/requirements-sdv.txt");
    expect(workflow).not.toContain(
      "python -m pip install -r engine/requirements.txt -r engine/requirements-build.txt",
    );
    expect(dependencyCheck).toContain(
      'ALLOWED_MISSING_SDV_REQUIREMENTS = {"ctgan", "deepecho"}',
    );
    expect(dependencyCheck).toContain(
      'FORBIDDEN_DISTRIBUTIONS = {"ctgan", "deepecho", "torch", "triton"}',
    );
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
