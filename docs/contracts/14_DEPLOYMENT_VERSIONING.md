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

A future app updater may be added using the Electron packaging stack chosen by implementation. Do not build update-channel complexity before the packaged application itself is reliable.

## CI

Use native target runners where practical. Build and smoke-test actual artifacts on supported OSes.

Release automation should stay minimal until signing/publishing credentials and a real release process exist.
