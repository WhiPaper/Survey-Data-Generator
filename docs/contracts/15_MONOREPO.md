# Monorepo & Dependency Rules

## Recommended structure

```text
apps/
  desktop/
    src/
      main/
      preload/
      renderer/

packages/
  domain/
  contracts/
  test-support/

engine/
  main.py
  prepare.py
  generate.py
  select.py
  evaluate.py

tests/
scripts/
```

Use pnpm for the TypeScript workspace. Do not add Nx/Turborepo unless build complexity demonstrates a need.

## `packages/domain`

Owns pure product meaning:

- IDs
- normalized Form/answer-state types
- SourceRevision / SourceScope
- ValueGroup
- Target
- RunSpec / EditPlan / RunResult contracts
- small pure target/domain helpers

Aim for near-zero runtime dependencies.

Must not import React, Electron, Google SDKs, SQLite, Drizzle, or Python/solver-specific concepts.

## `packages/contracts`

Owns renderer↔preload/Main DTOs and runtime validation where needed.

Do not turn this into a generic backend protocol library; there is one bundled application.

## `apps/desktop`

### Main

Owns Google integration, persistence, jobs, export, and compute process invocation.

### Preload

Exposes narrow typed capabilities to the renderer.

### Renderer

Owns UI only. It does not import Main infrastructure, SQLite, Google SDKs, filesystem/process modules, or Python tooling.

## `engine`

Python compute engine. Keep it small and function-oriented.

Initial responsibility split:

```text
main.py      CLI / job I/O
prepare.py   dataframe + metadata + derived features
generate.py  SDV candidate generation
select.py    target compilation + SciPy MILP
evaluate.py  hard checks + SDMetrics
```

Do not create `services/`, `repositories/`, `providers/`, `plugins/`, `calibration/`, `repair/`, `temporal/`, or `relationships/` directories without a demonstrated requirement.

## Removed v1 structure

The v2 architecture does not contain:

```text
src-tauri/
apps/sidecar/
packages/statistics/
packages/synthesis-core/
```

Existing useful code may be selectively moved, but these architectural boundaries should not be preserved for compatibility.

## Dependency-first rule

Python scientific libraries own general-purpose computation. TypeScript application code should not duplicate their algorithms.

Do not wrap dependencies merely to rename their API. Add a wrapper/function when it expresses Survey Synth product semantics, stabilizes a real boundary, or simplifies testing.

## Boundary enforcement

Enforce only meaningful rules, for example:

```text
domain cannot import apps/infrastructure
desktop renderer cannot import Main-only modules
production cannot import test-support
```

Avoid a large abstract dependency graph before the codebase requires it.

## No dumping grounds

Do not create generic `shared`, `common`, or `utils` packages. Put a helper beside the responsibility that owns it unless multiple real consumers justify a dedicated module.
