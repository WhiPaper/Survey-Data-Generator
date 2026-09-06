import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (!["win32", "linux"].includes(process.platform)) {
  throw new Error(`Packaged desktop smoke is unsupported on ${process.platform}`);
}
if (process.arch !== "x64") {
  throw new Error(`Packaged desktop smoke requires x64, got ${process.arch}`);
}

const desktopDist = resolve("apps", "desktop", "dist");
const unpacked = resolve(
  desktopDist,
  process.platform === "win32" ? "win-unpacked" : "linux-unpacked",
);
const executable = resolve(
  unpacked,
  process.platform === "win32" ? "survey-synth.exe" : "survey-synth",
);
const resources = resolve(unpacked, "resources");
const engine = resolve(
  resources,
  "engine",
  process.platform === "win32" ? "survey-synth-engine.exe" : "survey-synth-engine",
);
const smokeRoot = resolve(".local-desktop-packaged-smoke");

for (const [label, path] of [
  ["Electron executable", executable],
  ["packaged Python engine", engine],
]) {
  if (!existsSync(path)) throw new Error(`${label} was not found: ${path}`);
}

rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

const result = spawnSync(executable, process.platform === "linux" ? ["--no-sandbox"] : [], {
  encoding: "utf8",
  env: {
    ...process.env,
    SURVEY_SYNTH_PACKAGED_SMOKE: "1",
    SURVEY_SYNTH_PACKAGED_SMOKE_DIR: smokeRoot,
    SURVEY_SYNTH_GOOGLE_CLIENT_ID: "packaged-smoke.apps.googleusercontent.com",
  },
  maxBuffer: 10 * 1024 * 1024,
  stdio: "pipe",
  timeout: 120_000,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.signal) throw new Error(`Packaged Electron smoke ended with signal ${result.signal}`);
if (result.status !== 0) process.exit(result.status ?? 1);
if (!result.stdout.includes("PACKAGED_SMOKE_OK")) {
  throw new Error("Packaged Electron smoke did not report success");
}

for (const relative of [
  "survey-synth.sqlite",
  "packaged-smoke/engine/report.json",
  "packaged-smoke/result.csv",
  "packaged-smoke/result.xlsx",
]) {
  const path = resolve(smokeRoot, relative);
  if (!existsSync(path)) throw new Error(`Packaged smoke output is missing: ${path}`);
}

console.log(`Packaged Electron smoke passed: ${smokeRoot}`);
