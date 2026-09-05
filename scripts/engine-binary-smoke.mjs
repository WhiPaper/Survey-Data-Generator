import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const executable = resolve(
  "engine",
  "dist",
  process.platform === "win32" ? "survey-synth-engine.exe" : "survey-synth-engine",
);
const workDir = resolve(".local-engine-binary-smoke");

if (!existsSync(executable)) {
  throw new Error(`Packaged Python engine was not found: ${executable}`);
}

rmSync(workDir, { recursive: true, force: true });
const result = spawnSync(executable, ["selftest", "--work-dir", workDir], {
  encoding: "utf8",
  stdio: "pipe",
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

for (const name of ["job.json", "source.parquet", "result.parquet", "report.json"]) {
  const file = resolve(workDir, name);
  if (!existsSync(file)) throw new Error(`Engine smoke output is missing: ${file}`);
}

console.log(`Packaged engine smoke passed: ${workDir}`);
