import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { glob } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const noInternalPackageSource = /^@survey-synth\/[^/]+\/src(?:\/|$)/;
const noRelativeInternalSource = /^(?:\.\.\/)+(?:apps|packages)\/[^/]+\/src(?:\/|$)/;
const noNodeRuntime = /^node:/;
const packageRules = [
  {
    name: "domain",
    files: "packages/domain/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/(contracts|test-support)/,
      /^(react|react-dom|zod)/,
      /(^|\/)apps\//,
      noInternalPackageSource,
      noNodeRuntime,
      /(google|sqlite|highs|solver)/i,
    ],
  },
  {
    name: "contracts",
    files: "packages/contracts/src/**/*.ts",
    forbidden: [
      /^@survey-synth\/test-support/,
      noInternalPackageSource,
      noNodeRuntime,
      /^(react|react-dom)/,
      /(^|\/)apps\//,
      /(google|sqlite|highs|solver)/i,
    ],
  },
  {
    name: "desktop-renderer",
    files: "apps/desktop/src/**/*.{ts,tsx}",
    forbidden: [
      /^@survey-synth\/test-support/,
      noInternalPackageSource,
      /^(node:|fs$|fs\/|path$|path\/)/,
      /(google|sqlite|highs|solver)/i,
      /(^|\/)electron\//,
    ],
  },
  {
    name: "tests",
    files: "apps/desktop/test/**/*.{ts,tsx}",
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
