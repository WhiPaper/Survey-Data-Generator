import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const versions = await readJson("versions.json");
const packageJson = await readJson("package.json");
const desktopPackageJson = await readJson("apps/desktop/package.json");
const sidecarPackageJson = await readJson("apps/sidecar/package.json");
const tauriConfig = await readJson("src-tauri/tauri.conf.json");
const cargoToml = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const requiredNumericFields = [
  "protocolVersion",
  "databaseSchemaVersion",
  "domainSchemaVersion",
  "engineVersion",
  "profilerVersion",
];

if (typeof versions.appVersion !== "string" || versions.appVersion.length === 0) {
  throw new Error("versions.json appVersion must be a non-empty string");
}
for (const field of requiredNumericFields) {
  const minimum = field === "protocolVersion" ? 1 : 0;
  if (!Number.isInteger(versions[field]) || versions[field] < minimum) {
    throw new Error(`versions.json ${field} must be an integer >= ${minimum}`);
  }
}

const appVersions = {
  rootPackage: packageJson.version,
  desktopPackage: desktopPackageJson.version,
  sidecarPackage: sidecarPackageJson.version,
  cargoPackage: cargoVersion,
  tauriConfig: tauriConfig.version,
};
for (const [source, version] of Object.entries(appVersions)) {
  if (version !== versions.appVersion) {
    throw new Error(`${source} version does not match versions.json appVersion`);
  }
}

console.log("Version constants passed.");
