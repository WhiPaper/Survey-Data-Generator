# Deployment, Packaging & Versioning

## One application bundle

The user receives one Electron application containing:

```text
Electron runtime
React renderer
Electron Main/preload
SQLite native dependency
packaged Python compute executable
Python engine dependencies/resources
```

End users do not install Node.js, Python, pip, or an external solver.

## Python packaging

Use PyInstaller first unless packaging/size/startup benchmarks justify another tool such as Nuitka.

The compute executable is versioned and shipped with the application. It is not separately downloaded or updated in v2.

`SURVEY_SYNTH_ENGINE_EXECUTABLE` is a development-only override. Packaged applications always resolve and execute the engine bundled under `resources/engine`; user-installed Python and environment overrides must not affect packaged compute.

## Initial targets

Initial release packaging targets:

| OS | Arch |
|---|---|
| Windows | x86_64 |
| Linux | x86_64 |

macOS is outside the initial release scope unless explicitly reconsidered.

## Version model

Keep versioning small:

```text
appVersion
computeEngineVersion
databaseSchemaVersion
```

No Rust/sidecar protocol version exists in v2.

A Run freezes the compute engine version used to create it and persists the result itself.

## Database schema

Start v2 from schema `0001`. There is no requirement to migrate current development databases because the product has not been distributed.

After the first public release, introduce normal forward migrations when needed.

## Packaging correctness

A development run is not enough. Smoke-test the actual packaged/installed artifact for:

```text
Electron startup
SQLite open/read/write
Google OAuth URL/loopback setup
Python engine discovery/spawn
Parquet input/output
SDV import/runtime
SciPy MILP runtime
SDMetrics runtime
compute cancellation
CSV export
XLSX export
```

Native dependency packaging failures block release of that target.

## Updates

Do not design a separate compute-engine update channel. Application and compute engine ship together.

The current Windows and Linux release process may check `WhiPaper/Survey-Data-Generator` for the latest non-prerelease application Release. Packaged builds may contain a fine-grained repository credential limited to `Contents: Read-only` so end users do not need GitHub credentials. Treat this value as extractable from the desktop binary and never grant it write authority.

Update checks and downloads run in Electron Main only. The renderer and preload do not receive the updater credential or direct update capability. The updater must not pass that credential through `GH_TOKEN`, `GITHUB_TOKEN`, or Python child-process environment variables.

A downloaded update must match a newer stable app version and be verified against GitHub's reported SHA-256 release-asset digest and size before installation is offered. Installation is user-approved: ask whether to restart, then use the platform update path. Do not force-restart the application during active work.

Windows uses the per-user NSIS silent installer path. Linux AppImage builds stage the verified replacement beside the running AppImage, wait for the current process to exit, atomically replace the original AppImage path, preserve executable permissions, and relaunch the updated AppImage. If the current AppImage directory is not writable, the update must fail without damaging the running installation.

## CI

Use native target runners where practical. Build and smoke-test actual artifacts on supported OSes.

Normal package jobs keep electron-builder publishing disabled. GitHub Release publication must be an explicit workflow-dispatch choice, run only after configured artifact jobs succeed, use job-scoped write authority, and refuse to replace an existing release automatically.
