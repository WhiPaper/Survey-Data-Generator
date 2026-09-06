# Survey Synth

Survey Synth is a local-first Electron desktop application that imports Google Form responses and produces a larger final dataset that satisfies user-defined statistical targets while preserving structural and statistical plausibility.

## Architecture

```text
React Renderer
    ↓
Preload / contextBridge
    ↓
Electron Main
    ├─ Google integration
    ├─ SQLite + Drizzle
    ├─ projects / sources / runs / export
    ├─ Windows private GitHub Release updater
    └─ packaged Python compute process
          ├─ pandas / PyArrow
          ├─ SDV
          ├─ scipy.optimize.milp
          └─ SDMetrics
```

The renderer never accesses SQLite, Google APIs, filesystem primitives, OAuth tokens, update credentials, or Python directly. The Python executable runs one job and exits; it is not a daemon or application backend.

## Development

Installed users do not need Node.js or Python. Development requires Node.js `24.20.0`, pnpm `11.19.0`, and Python `3.12`.

```powershell
pnpm install
pnpm run check
pnpm run dev
```

For the Python engine:

```powershell
pnpm run engine:install
pnpm run engine:test
pnpm run engine:build
pnpm run engine:binary-smoke
```

`engine:install` keeps the complete upstream SDV dependency graph for general development. The packaged-artifact workflow instead uses `engine:install:packaged`, which installs the SDV 1.38.0 Gaussian Copula runtime without the unused CTGAN/DeepEcho neural dependency branch and verifies that Torch/CUDA distributions are absent before packaging.

## Packaging

Build the renderer/Main bundle and package the supported targets:

```powershell
pnpm run build
pnpm run package:desktop:dir
pnpm run package:desktop:smoke
pnpm run package:desktop:artifact
```

Initial artifact targets are Windows x64 NSIS and Linux x64 AppImage. Local artifacts are validation outputs. The packaged-artifacts workflow keeps normal builds unpublished; its explicit `publish_release` input creates a GitHub Release only after both configured artifact jobs succeed.

Official Windows packaged builds require `SURVEY_SYNTH_UPDATE_GITHUB_TOKEN`, a fine-grained token limited to this repository with `Contents: Read-only`. It is injected into Electron Main only. Because a desktop binary can be inspected, this updater credential is treated as extractable rather than confidential; it must never have write permission. Linux builds do not receive the updater credential.

The Windows packaged app checks the repository's latest non-prerelease GitHub Release, downloads a newer NSIS installer, verifies the SHA-256 digest reported by GitHub, and asks the user whether to restart. Approval launches the per-user installer silently. Linux automatic updating is not enabled in the current release plan.

## Google OAuth development

Provide OAuth configuration through `google_oauth.local.json` or environment variables:

- `SURVEY_SYNTH_GOOGLE_CLIENT_ID`
- `SURVEY_SYNTH_GOOGLE_CLIENT_SECRET` when required

Never commit credentials or expose them through renderer build-time variables.
