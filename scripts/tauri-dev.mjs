import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { once } from "node:events";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commandSpec = (command, args) =>
  process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`]]
    : [command, args];

const run = async (command, args) => {
  const [program, programArgs] = commandSpec(command, args);
  const child = spawn(program, programArgs, {
    stdio: "inherit",
    env: process.env,
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
};

const waitForPort = (host, port) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const attempt = () => {
      const socket = createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error(`Vite did not open ${host}:${port}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });

const assertPortAvailable = (host, port) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`Port ${port} is already in use; stop the existing dev server first`));
    });
    socket.once("error", () => {
      socket.destroy();
      resolve();
    });
  });

await run(pnpm, ["run", "build:sidecar"]);
await run(pnpm, ["--filter", "@survey-synth/desktop", "build"]);
await assertPortAvailable("127.0.0.1", 1420);

const [viteProgram, viteArgs] = commandSpec(pnpm, ["--filter", "@survey-synth/desktop", "dev"]);
const vite = spawn(viteProgram, viteArgs, {
  stdio: "inherit",
  env: process.env,
});

try {
  await waitForPort("127.0.0.1", 1420);
  const tauri = spawn("cargo", ["run", "--manifest-path", "src-tauri/Cargo.toml"], {
    stdio: "inherit",
    env: process.env,
  });
  await once(tauri, "exit");
} finally {
  vite.kill();
}
