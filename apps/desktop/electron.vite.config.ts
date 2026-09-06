import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const bundledPackages = [
  "@survey-synth/contracts",
  "@survey-synth/domain",
  "hyparquet",
  "hyparquet-writer",
];

const buildGoogleClientId = process.env.SURVEY_SYNTH_GOOGLE_CLIENT_ID?.trim() ?? "";
const buildGoogleClientSecret = process.env.SURVEY_SYNTH_GOOGLE_CLIENT_SECRET?.trim() ?? "";
const buildUpdateGithubToken = process.env.SURVEY_SYNTH_UPDATE_GITHUB_TOKEN?.trim() ?? "";

export default defineConfig({
  main: {
    define: {
      __SURVEY_SYNTH_GOOGLE_CLIENT_ID__: JSON.stringify(buildGoogleClientId),
      __SURVEY_SYNTH_GOOGLE_CLIENT_SECRET__: JSON.stringify(buildGoogleClientSecret),
      __SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__: JSON.stringify(buildUpdateGithubToken),
    },
    plugins: [externalizeDepsPlugin({ exclude: bundledPackages })],
    build: {
      rollupOptions: {
        input: resolve(root, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledPackages })],
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
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve(root, "index.html"),
      },
    },
  },
});
