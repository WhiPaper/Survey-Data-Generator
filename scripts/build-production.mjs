import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const vite = join(root, "apps", "desktop", "node_modules", "vite", "bin", "vite.js");

const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

for (const packagePath of [
  "packages/domain",
  "packages/contracts",
  "packages/statistics",
  "packages/synthesis-core",
  "packages/test-support",
  "apps/sidecar",
]) {
  run([tsc, "-p", "tsconfig.build.json"], join(root, packagePath));
}

run([join(root, "scripts", "stage-sidecar.mjs")]);
run([tsc, "-p", "tsconfig.json", "--noEmit"], join(root, "apps/desktop"));
run([vite, "build"], join(root, "apps/desktop"));
