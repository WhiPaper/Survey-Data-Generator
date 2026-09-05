import { spawnSync } from "node:child_process";

const pnpm = "pnpm";
const commands = [
  ["run", "format:check"],
  ["run", "lint"],
  ["run", "typecheck"],
  ["run", "build"],
  ["run", "test"],
];

for (const args of commands) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : pnpm;
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", `${pnpm} ${args.join(" ")}`] : args;
  const result = spawnSync(executable, commandArgs, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CI: "true" },
  });
  if (result.error) {
    console.error(`Command failed to start: ${executable} ${commandArgs.join(" ")}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
