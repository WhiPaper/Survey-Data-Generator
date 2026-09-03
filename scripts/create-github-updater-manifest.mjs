import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const sourceDirectory = process.argv[2];
const outputDirectory = process.argv[3];
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;

if (!sourceDirectory || !outputDirectory || !repository || !tag?.startsWith("v")) {
  throw new Error(
    "usage: create-github-updater-manifest.mjs <artifacts-dir> <output-dir>; GITHUB_REPOSITORY and a v* GITHUB_REF_NAME are required",
  );
}

const platformSources = [
  ["windows-x86_64", "windows-x64", /-setup\.exe$/i],
  ["linux-x86_64", "linux-x64", /\.AppImage$/i],
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return paths.flat();
}

const sourceFiles = await filesUnder(resolve(sourceDirectory));
const signedArtifacts = sourceFiles.filter((path) => path.endsWith(".sig"));
const platforms = {};
const copiedNames = new Set();

await mkdir(resolve(outputDirectory), { recursive: true });

for (const [platform, artifactDirectory, matcher] of platformSources) {
  const signatures = signedArtifacts.filter(
    (path) => path.includes(`${artifactDirectory}/`) && matcher.test(path.slice(0, -4)),
  );
  if (signatures.length !== 1) {
    throw new Error(
      `expected exactly one ${platform} updater signature, found ${signatures.length}`,
    );
  }

  const signaturePath = signatures[0];
  const artifactPath = signaturePath.slice(0, -4);
  const artifactName = `${platform}-${basename(artifactPath)}`;
  if (copiedNames.has(artifactName)) {
    throw new Error(`duplicate updater artifact name: ${artifactName}`);
  }
  copiedNames.add(artifactName);

  await cp(artifactPath, join(outputDirectory, artifactName));
  await cp(signaturePath, join(outputDirectory, `${artifactName}.sig`));
  platforms[platform] = {
    signature: (await readFile(signaturePath, "utf8")).trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(artifactName)}`,
  };
}

await writeFile(
  join(outputDirectory, "latest.json"),
  `${JSON.stringify(
    {
      version: tag.slice(1),
      notes: `Release ${tag}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
