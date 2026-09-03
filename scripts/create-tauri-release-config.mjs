import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const endpoint = process.env.SURVEY_SYNTH_UPDATER_ENDPOINT?.trim();
const pubkey = process.env.SURVEY_SYNTH_UPDATER_PUBKEY?.trim();

if (!endpoint || !pubkey) {
  throw new Error(
    "SURVEY_SYNTH_UPDATER_ENDPOINT and SURVEY_SYNTH_UPDATER_PUBKEY are required for release builds",
  );
}

const urlForValidation = endpoint.replace(/\{\{[^}]+\}\}/g, "placeholder");
const parsedEndpoint = new URL(urlForValidation);
if (parsedEndpoint.protocol !== "https:") {
  throw new Error("SURVEY_SYNTH_UPDATER_ENDPOINT must use HTTPS");
}

const config = {
  bundle: {
    createUpdaterArtifacts: true,
  },
  plugins: {
    updater: {
      pubkey,
      endpoints: [endpoint],
      windows: {
        installMode: "passive",
      },
    },
  },
};

await writeFile(
  resolve(root, "src-tauri", "tauri.release.generated.conf.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8",
);
