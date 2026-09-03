import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stageRoot = join(root, "src-tauri", "resources", "sidecar");
const appRoot = join(stageRoot, "app");
const runnerRoot = join(stageRoot, "runner");
const nodeName = process.platform === "win32" ? "node.exe" : "node";

const runPnpm = (args) => {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      CI: "true",
      NODE_ENV: "development",
      npm_config_production: "false",
      npm_config_confirm_modules_purge: "false",
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const assertFile = async (path, description) => {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`Sidecar staging is incomplete: ${description}`);
  }
};

const assertAbsent = async (path, description) => {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Sidecar staging must not contain ${description}`);
};

const scanForForbiddenFiles = async (directory) => {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await (
      await import("node:fs/promises")
    ).readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if ([".env", "google_oauth.local.json"].includes(entry.name)) {
        throw new Error(`Sidecar staging contains forbidden file: ${relative(stageRoot, path)}`);
      }
    }
  }
};

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });

// `deploy` follows the lockfile and creates a production-only dependency tree,
// including the SQLCipher native addon and HiGHS package assets.
runPnpm(["--filter", "@survey-synth/sidecar", "deploy", "--prod", "--legacy", appRoot]);
await cp(process.execPath, join(runnerRoot, nodeName), { force: true });

await assertFile(join(runnerRoot, nodeName), "bundled Node runtime is missing");
await assertFile(join(appRoot, "dist", "main.js"), "compiled sidecar entrypoint is missing");
await assertFile(
  join(appRoot, "node_modules", "better-sqlite3-multiple-ciphers", "package.json"),
  "SQLCipher package is missing",
);
await assertFile(
  join(appRoot, "node_modules", "highs", "package.json"),
  "HiGHS package is missing",
);
await assertFile(
  join(appRoot, "node_modules", "exceljs", "package.json"),
  "ExcelJS package is missing",
);
await assertAbsent(join(appRoot, "src"), "source files");
await assertAbsent(join(appRoot, "test"), "test fixtures");
await scanForForbiddenFiles(stageRoot);

const versions = JSON.parse(await readFile(join(root, "versions.json"), "utf8"));
await writeFile(
  join(stageRoot, "manifest.json"),
  `${JSON.stringify({ ...versions, entrypoint: "app/dist/main.js", runtime: `runner/${nodeName}` }, null, 2)}\n`,
  "utf8",
);

runPnpm(["install", "--production=false"]);
