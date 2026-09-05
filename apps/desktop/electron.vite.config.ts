import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, "electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root,
    resolve: {
      alias: {
        "@": resolve(root, "src"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(root, "index.html"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
