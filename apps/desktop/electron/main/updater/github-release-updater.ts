import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { request } from "node:https";
import { join } from "node:path";

import { app, dialog } from "electron";

import { isNewerStableVersion } from "./version";

declare const __SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__: string;

const UPDATE_OWNER = "WhiPaper";
const UPDATE_REPOSITORY = "Survey-Data-Generator";
const GITHUB_API_VERSION = "2022-11-28";
const UPDATE_CHECK_DELAY_MS = 10_000;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

type ReleaseAsset = {
  id: number;
  name: string;
  size: number;
  state: string;
  digest?: string | null;
};

type LatestRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

const getBuildUpdateToken = (): string =>
  typeof __SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__ === "string"
    ? __SURVEY_SYNTH_UPDATE_GITHUB_TOKEN__.trim()
    : "";

const githubHeaders = (token: string, accept: string): Record<string, string> => ({
  Accept: accept,
  Authorization: `Bearer ${token}`,
  "User-Agent": `Survey-Synth/${app.getVersion()}`,
  "X-GitHub-Api-Version": GITHUB_API_VERSION,
});

const requestJson = <T>(path: string, token: string): Promise<T | null> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: githubHeaders(token, "application/vnd.github+json"),
      },
      (response) => {
        if (response.statusCode === 404) {
          response.resume();
          resolve(null);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub update request failed with status ${response.statusCode ?? 0}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch {
            reject(new Error("GitHub update response was invalid"));
          }
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () =>
      req.destroy(new Error("GitHub update request timed out")),
    );
    req.on("error", reject);
    req.end();
  });

const hashFile = async (filename: string): Promise<string> => {
  const hash = createHash("sha256");
  const stream = createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const expectedSha256 = (asset: ReleaseAsset): string | null => {
  const digest = asset.digest?.trim().toLowerCase();
  if (!digest?.startsWith("sha256:")) return null;
  const value = digest.slice("sha256:".length);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
};

const cachedInstallerIsValid = async (
  filename: string,
  asset: ReleaseAsset,
  expectedDigest: string,
): Promise<boolean> => {
  try {
    const details = await stat(filename);
    if (details.size !== asset.size) return false;
    return (await hashFile(filename)) === expectedDigest;
  } catch {
    return false;
  }
};

const downloadToFile = async (
  url: URL,
  filename: string,
  token: string,
  redirectCount = 0,
): Promise<void> => {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error("GitHub update download redirected too many times");
  }

  await new Promise<void>((resolve, reject) => {
    const isGitHubApi = url.hostname === "api.github.com";
    const req = request(
      url,
      {
        method: "GET",
        headers: isGitHubApi
          ? githubHeaders(token, "application/octet-stream")
          : { "User-Agent": `Survey-Synth/${app.getVersion()}` },
      },
      async (response) => {
        const statusCode = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error("GitHub update download redirect was invalid"));
            return;
          }
          try {
            await downloadToFile(new URL(location, url), filename, token, redirectCount + 1);
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub update download failed with status ${statusCode}`));
          return;
        }

        const output = createWriteStream(filename, { flags: "w", mode: 0o600 });
        try {
          for await (const chunk of response) {
            if (!output.write(chunk as Buffer)) await once(output, "drain");
          }
          output.end();
          await once(output, "finish");
          resolve();
        } catch (error) {
          output.destroy();
          reject(error);
        }
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () =>
      req.destroy(new Error("GitHub update download timed out")),
    );
    req.on("error", reject);
    req.end();
  });
};

const chooseWindowsInstaller = (assets: ReleaseAsset[]): ReleaseAsset | null => {
  const candidates = assets.filter(
    (asset) => asset.state === "uploaded" && asset.size > 0 && /\.exe$/i.test(asset.name),
  );
  if (candidates.length === 1) return candidates[0]!;
  return candidates.find((asset) => /setup/i.test(asset.name)) ?? null;
};

const prepareInstaller = async (
  release: LatestRelease,
  token: string,
): Promise<{ filename: string; version: string } | null> => {
  const asset = chooseWindowsInstaller(release.assets);
  if (!asset) return null;
  const digest = expectedSha256(asset);
  if (!digest) return null;

  const version = release.tag_name.replace(/^v/, "");
  const filename = join(app.getPath("temp"), `survey-synth-update-${version}.exe`);
  if (!(await cachedInstallerIsValid(filename, asset, digest))) {
    await rm(filename, { force: true });
    await downloadToFile(
      new URL(
        `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/assets/${asset.id}`,
      ),
      filename,
      token,
    );
  }

  if (!(await cachedInstallerIsValid(filename, asset, digest))) {
    await rm(filename, { force: true });
    throw new Error("Downloaded update failed integrity verification");
  }
  return { filename, version };
};

const checkForUpdate = async (token: string): Promise<void> => {
  const release = await requestJson<LatestRelease>(
    `/repos/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/latest`,
    token,
  );
  if (!release || release.draft || release.prerelease) return;
  if (!isNewerStableVersion(release.tag_name, app.getVersion())) return;

  const installer = await prepareInstaller(release, token);
  if (!installer) return;

  const result = await dialog.showMessageBox({
    type: "info",
    title: "Survey Synth 업데이트",
    message: `Survey Synth ${installer.version} 업데이트가 준비되었습니다.`,
    detail: "지금 재시작하면 업데이트가 자동으로 설치됩니다.",
    buttons: ["지금 재시작", "나중에"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response !== 0) return;

  const child = spawn(installer.filename, ["--updated", "/S", "--force-run"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  app.quit();
};

export const schedulePrivateGitHubUpdateCheck = (): void => {
  if (!app.isPackaged || process.platform !== "win32") return;
  const token = getBuildUpdateToken();
  if (!token) return;
  setTimeout(() => {
    void checkForUpdate(token).catch(() => {
      console.warn("Survey Synth update check failed");
    });
  }, UPDATE_CHECK_DELAY_MS);
};
