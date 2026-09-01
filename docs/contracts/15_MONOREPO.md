# Monorepo & Dependency Rules

## Top-level structure

```text
/
├─ apps/
│  ├─ desktop/
│  └─ sidecar/
│
├─ packages/
│  ├─ domain/
│  ├─ contracts/
│  ├─ statistics/
│  ├─ synthesis-core/
│  └─ test-support/
│
├─ src-tauri/
│
├─ tests/
│  ├─ integration/
│  ├─ e2e/
│  └─ benchmark/
│
└─ scripts/
```

Use pnpm workspace initially.

Do not add Nx/Turborepo unless build/runtime complexity later justifies it.

## Dependency direction

```text
domain
  ↑
  ├─ contracts
  │    ↑
  │    ├─ desktop
  │    └─ sidecar
  │
  ├─ statistics
  │    ↑
  │
  └─ synthesis-core
       ↑
     sidecar
```

No cycles.

## `packages/domain`

Contains pure product meaning:

- IDs
- form/question/group/logic types
- response and answer states
- profile contracts
- targets
- project/source revision
- synthesis-domain contracts
- small pure domain math

Aim for near-zero runtime dependencies.

Forbidden imports:

- React
- Tauri
- Zod
- Google SDK
- SQLite
- HiGHS
- Node fs/worker APIs

## `packages/contracts`

Owns cross-process/client DTOs and runtime validation.

Dependencies allowed:

- domain
- Zod

Forbidden:

- React implementation
- Tauri
- SQLite
- Google SDK
- solver

## `packages/statistics`

Owns pure:

- descriptive stats
- quantiles
- Cramér's V / Phi
- Pearson / Spearman
- question profiling
- semantic inference
- relationship analysis

Depends on domain only where practical.

No sidecar/DB/Google imports.

## `packages/synthesis-core`

Owns:

- TargetCompiler
- ConstraintCompiler
- FeasibilityChecker core
- FeatureCompiler
- WeightOptimizer logic
- RowAllocator
- mutation algorithms
- repair
- validation
- seeded RNG

Depends on:

- domain
- statistics

Defines `OptimizationBackend` abstraction.

Does not import HiGHS directly.

## `apps/sidecar`

Owns application orchestration and infrastructure:

```text
rpc/
application/
google/
persistence/
optimization/
workers/
export/
ai/
logging/
host/
```

Repository/port interfaces live near application layer.

Concrete SQLite/Google/HiGHS implementations live in infrastructure areas.

## `apps/desktop`

Owns:

```text
app/
backend/
features/
components/ui/
lib/
```

May depend on domain/contracts plus React ecosystem.

Must not import:

- sidecar source
- SQLite
- Google SDK
- solver
- Node filesystem

UI does not independently reimplement statistical algorithms.

Backend returns prepared view models/feasibility information.

## `src-tauri`

Thin Rust only:

```text
backend/process/bridge/protocol
host opener/secrets/dialogs/paths
Tauri commands/capabilities
```

Do not create Rust mirrors of business-domain DTOs.

Business RPC payload may be forwarded as opaque JSON.

Rust interprets only transport/host capability fields.

## `packages/test-support`

Fixture builders/fakes only:

- Form builder
- Response builder
- target builder
- fake optimizer
- fake Google
- seeded fixtures

Production packages must never depend on it.

## Forbidden architecture patterns

Do not create a vague:

```text
packages/shared
packages/common
packages/utils
```

dumping ground initially.

Put code in the package that owns its meaning.

Do not permit internal source imports such as:

```ts
@app/domain/src/internal/foo
```

Use package `exports` and meaningful subpaths such as:

```text
@app/domain/form
@app/domain/response
@app/domain/target
@app/domain/synthesis
```

Avoid a single enormous barrel if subpath exports make dependencies clearer.

## Boundary enforcement

Use ESLint `no-restricted-imports`, dependency-cruiser, or equivalent CI rule.

Examples:

```text
packages/domain/** cannot import apps/**
packages/domain/** cannot import react/@tauri/google/sqlite/highs
statistics cannot import synthesis-core or sidecar
synthesis-core cannot import sidecar infrastructure
desktop cannot import sidecar source
```

Violation fails CI.

## Development vs production sidecar

Development may run through the local Node runtime/watch build.

Production is packaged/self-contained for the user.

RPC protocol remains identical in both modes.

## Workers

Worker entries are explicit build entrypoints and must be included in packaged-artifact smoke tests.

## Migrations

Prefer migrations compiled into the sidecar build rather than dynamically discovering arbitrary TS migration files by runtime filesystem path.
