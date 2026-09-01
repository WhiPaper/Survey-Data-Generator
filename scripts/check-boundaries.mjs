import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { glob } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const noInternalPackageSource = /^@survey-synth\/[^/]+\/src(?:\/|$)/;
const noRelativeInternalSource = /^(?:\.\.\/)+(?:apps|packages|src-tauri)\/[^/]+\/src(?:\/|$)/;
const noNodeRuntime = /^node:/;
const packageRules = [
  {
    name: "domain",
    files: "packages/domain/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/(contracts|statistics|synthesis-core|test-support)/,
      /^(react|react-dom|zod|tauri|@tauri\/)/,
      /(^|\/)(apps|src-tauri)\//,
      noInternalPackageSource,
      noNodeRuntime,
      /(google|sqlite|highs|solver)/i,
    ],
  },
  {
    name: "contracts",
    files: "packages/contracts/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/(statistics|synthesis-core|test-support)/,
      noInternalPackageSource,
      noNodeRuntime,
      /^(react|react-dom|tauri|@tauri\/)/,
      /(^|\/)(apps|src-tauri)\//,
      /(google|sqlite|highs|solver)/i,
    ],
  },
  {
    name: "statistics",
    files: "packages/statistics/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/(contracts|synthesis-core|test-support)/,
      noInternalPackageSource,
      noNodeRuntime,
      /^(react|react-dom|tauri|@tauri\/)/,
      /(^|\/)(apps|src-tauri)\//,
      /(google|sqlite|highs|solver|sidecar)/i,
    ],
  },
  {
    name: "synthesis-core",
    files: "packages/synthesis-core/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/(contracts|test-support)/,
      noInternalPackageSource,
      noNodeRuntime,
      /^(react|react-dom|tauri|@tauri\/)/,
      /(^|\/)(apps|src-tauri)\//,
      /(google|sqlite|highs|solver)/i,
    ],
  },
  {
    name: "desktop",
    files: "apps/desktop/src/**/*.{ts,tsx}",
    forbidden: [
      /^@survey-synth\/(sidecar|statistics|synthesis-core|test-support)/,
      noInternalPackageSource,
      /^(node:|fs$|fs\/|path$|path\/)/,
      /(google|sqlite|highs|solver)/i,
      /(^|\/)src-tauri\//,
    ],
  },
  {
    name: "tests",
    files: "tests/**/*.{ts,tsx}",
    forbidden: [noInternalPackageSource, noRelativeInternalSource],
  },
];

const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const failures = [];

for (const rule of packageRules) {
  for await (const file of glob(rule.files, { cwd: root })) {
    const absolute = resolve(root, file);
    const source = await readFile(absolute, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier && rule.forbidden.some((pattern) => pattern.test(specifier))) {
        failures.push(`${rule.name}: ${relative(root, absolute)} imports ${specifier}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Dependency boundary violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dependency boundaries passed.");
