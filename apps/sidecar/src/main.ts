import { stderrLogger } from "./rpc/logger.js";
import { createSidecarServer } from "./rpc/server.js";

const server = createSidecarServer({
  input: process.stdin,
  output: process.stdout,
  logger: stderrLogger,
  onShutdown: () => {
    process.stdin.pause();
    process.stdout.end(() => process.exit(0));
  },
});

const signalShutdown = (): void => {
  server.shutdown();
  process.exitCode = 0;
};

process.once("SIGINT", signalShutdown);
process.once("SIGTERM", signalShutdown);
