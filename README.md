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
    └─ packaged Python compute process
          ├─ pandas / PyArrow
          ├─ SDV
          ├─ scipy.optimize.milp
          └─ SDMetrics
```

The renderer never accesses SQLite, Google APIs, filesystem primitives, OAuth tokens, or Python directly. The Python executable runs one job and exits; it is not a daemon or application backend.

## Development

Installed users do not need Node.js or Python. Development requires Node.js `24.20.0`, pnpm `11.19.0`, and Python `3.12`.

```powershell
pnpm install
pnpm run check
pnpm run dev
```

For the Python engine:

```powershell
python -m pip install -r engine/requirements.txt -r engine/requirements-build.txt
pnpm run engine:test
pnpm run engine:build
pnpm run engine:binary-smoke
```

## Packaging

Build the renderer/Main bundle and package the supported targets:

```powershell
pnpm run build
pnpm run package:desktop:dir
pnpm run package:desktop:smoke
pnpm run package:desktop:artifact
```

Initial artifact targets are Windows x64 NSIS and Linux x64 AppImage. Local artifacts are validation outputs; release signing and publishing require the configured release process.

## Google OAuth development

Provide OAuth configuration through `google_oauth.local.json` or environment variables:

- `SURVEY_SYNTH_GOOGLE_CLIENT_ID`
- `SURVEY_SYNTH_GOOGLE_CLIENT_SECRET` when required

Never commit credentials or expose them through renderer build-time variables.
