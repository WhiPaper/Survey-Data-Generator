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

The current Windows release process may check the private `WhiPaper/Survey-Data-Generator` GitHub repository for the latest non-prerelease application Release. A packaged Windows build may contain a fine-grained repository credential limited to `Contents: Read-only` so end users do not need GitHub credentials. Treat this value as extractable from the desktop binary and never grant it write authority.

Update checks and downloads run in Electron Main only. The renderer and preload do not receive the updater credential or direct update capability. The updater must not pass that credential through `GH_TOKEN`, `GITHUB_TOKEN`, or Python child-process environment variables.

A downloaded Windows installer must be matched to a newer stable app version and verified against GitHub's reported SHA-256 release-asset digest before installation is offered. Installation is user-approved: ask whether to restart, then use the per-user NSIS silent update path. Do not force-restart the application during active work.

Linux automatic updating is not part of the current acceptance plan. Do not create a separate Linux update channel merely for parity.

## CI

Use native target runners where practical. Build and smoke-test actual artifacts on supported OSes.

Normal package jobs keep electron-builder publishing disabled. GitHub Release publication must be an explicit workflow-dispatch choice, run only after configured artifact jobs succeed, use job-scoped write authority, and refuse to replace an existing release automatically.
