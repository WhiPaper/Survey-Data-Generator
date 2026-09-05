# AGENTS.md

## Purpose

Survey Synth is a local-first desktop application for importing Google Form responses and producing a larger final dataset that satisfies user-defined statistical targets while remaining structurally and statistically plausible.

The authoritative product and architecture contracts live in `docs/contracts/`. Read them before changing implementation behavior.

The repository is pre-release. There is no deployed user base and no compatibility obligation to the current development database, IPC protocol, or implementation architecture. Prefer a clean v2 implementation over compatibility layers.

## Read first

Before implementation work:

1. Read `docs/contracts/README.md`.
2. Read `docs/contracts/17_DECISIONS.md`.
3. Read `docs/contracts/16_MILESTONES.md`.
4. Read the topic contract relevant to the task.
5. Inspect existing code and tests before deciding what to reuse.

Existing code is not authoritative when it conflicts with the v2 contracts.

## Core product invariants

- Google is the only account provider.
- A project is based on immutable imported source observations and immutable source revisions.
- A run freezes the exact `SourceScope`, target snapshot, value-group definitions, seed, and compute-engine version used for that result.
- `SourceScope` may select all responses or a submitted-time range. Every analysis, target calculation, synthesis run, result, and export must use the frozen scope.
- The user chooses a final response count. `syntheticCount = finalCount - sourceScopeCount`, except when approved original replacements require replacement candidates in addition to the requested synthetic additions.
- User targets apply to the final dataset, not only to generated rows.
- Initial target kinds are `count`, `share`, `mean`, and `conditional_share`.
- Percentage-point changes, relative percentage changes, absolute shares, and counts are distinct semantics. Never infer one from another silently.
- Short-text semantic grouping is user-defined through `ValueGroup`; the application does not claim to understand arbitrary concepts such as fruit, occupation, or residence automatically.
- `answered`, `skipped`, `not_reached`, and `indeterminate` remain distinct internally.
- Confirmed Google Form routing and allowed values must remain valid. Unknown routing is never invented.
- Append-only synthesis is attempted first.
- If append-only cannot achieve the requested result, the system may calculate a minimal original-row replacement plan. No original-derived row is changed in the final result without explicit user approval.
- Imported source observations themselves are never overwritten. Approved replacements are run transformations.
- Synthetic timestamps are part of the generated row and must be plausible for the frozen source scope.
- Obvious row-copy artifacts are a quality failure even when target values are correct.
- Default CSV/XLSX exports contain the final survey table without synthetic provenance columns.
- There is no LLM/AI feature in the v2 plan.

## Architecture invariants

```text
React Renderer
    ↓
Preload / contextBridge
    ↓
Electron Main
    ├─ Google integration
    ├─ SQLite + Drizzle
    ├─ projects / sources / runs / export
    ├─ job orchestration
    └─ packaged Python compute process
          ├─ pandas / pyarrow
          ├─ SDV
          ├─ scipy.optimize.milp
          └─ SDMetrics
```

- Electron Main owns product/application concerns.
- React does not access SQLite, Google APIs, filesystem primitives, OAuth tokens, or Python directly.
- Python is a compute engine, not the application backend and not a daemon.
- A compute job is a child process that reads configuration/data, writes result files, emits small progress events if needed, and exits.
- Use JSON for job configuration/metadata and Parquet for row data.
- Cancellation may terminate the compute child process. Do not build a bidirectional RPC framework unless a proven requirement appears.
- The end user must not install Python, Node.js, or an external solver.

## Dependency-first rule

Application-owned complexity is a primary optimization target. Dependency count is not.

Before implementing a general statistical, tabular-synthesis, optimization, dataframe, serialization, or quality algorithm, verify whether the chosen mainstream dependency already owns that responsibility.

Initial responsibilities:

- pandas / PyArrow — tabular data and Parquet
- Pydantic — compute job/control-plane validation
- SDV — tabular candidate generation, including datetime columns where supported
- SciPy `optimize.milp` — candidate selection, feasibility, and minimal original-replacement solving
- SDMetrics — general synthetic-data quality diagnostics
- Drizzle + better-sqlite3 — local application persistence

Do not add custom relationship analysis, Bayesian/DAG synthesis, copula implementations, calibration solvers, row-allocation frameworks, temporal models, diversity optimizers, NLP classifiers, or repair engines without a concrete scenario and benchmark showing the existing pipeline cannot meet the product requirement.

## Simplicity and extension policy

Extensibility means stable data boundaries, not speculative abstractions.

Prefer small functions and plain data structures. Do not create factories, provider registries, plugin systems, repository hierarchies, optimizer interfaces, generator class trees, or generic `shared/common/utils` packages merely because they may be useful later.

Stable compute stages are conceptually:

```text
prepare
→ generate candidates
→ compile targets/features
→ select
→ evaluate
```

A future implementation may replace how a stage works without changing the meaning of its input/output data.

## Domain boundaries

Core concepts should remain small:

- `Project`
- `SourceRevision`
- `SourceScope`
- `ValueGroup`
- `DerivedFeature`
- `Target`
- `RunSpec`
- `EditPlan`
- `RunResult`

Do not put Google SDK objects, Electron types, SQLite rows, SDV metadata objects, SciPy matrices, or export-library objects into domain types.

Target compilation should lower product targets into a small numeric/boolean feature representation. Do not build a public general-purpose target DSL.

## Source and Form rules

Reuse verified Google Form normalization and reachability logic where it remains valid, but remove legacy donor/mutation behavior tied to the old synthesis architecture.

A generated candidate must pass hard Form validation before it can enter a final result. If routing evidence is ambiguous, preserve uncertainty rather than inventing a path.

Structured choice questions may use any value allowed by the Form schema even when that option has zero observed responses. Arbitrary short-text values must not be invented automatically; use observed or user-provided values.

## Original replacement policy

Imported source data is evidence and remains immutable.

When append-only solving is infeasible:

1. solve for the minimum number of source rows that would need replacement,
2. build complete plausible replacement rows,
3. show the user the append-only result and the proposed replacement result,
4. require explicit approval,
5. freeze the approved `EditPlan` into the run.

Start with complete-row replacement. Do not build cell-level mutation or semantic edit-distance systems until a real product scenario requires them.

## Persistence

The project is pre-release. Do not preserve the existing development DB schema for compatibility.

- Start the v2 schema cleanly with Drizzle migrations from `0001`.
- No legacy importer is required.
- No encrypted SQLite requirement in v2.
- Use OS-appropriate secure credential storage for Google refresh tokens.
- Access tokens remain in memory.
- React never issues SQL.

Source revisions and saved runs are immutable historical records even though the development schema itself has no legacy compatibility requirement.

## Testing

Tests should be scenario- and invariant-driven.

At minimum cover:

- source-scope filtering and freezing
- final-count semantics
- mean target and nearest representable result
- share target
- conditional share, including checkbox overlap
- overlapping `ValueGroup`s
- infeasible append-only targets
- minimum original replacement and approval requirement
- form routing / required-question validity
- timestamp inside scope and distribution sanity
- duplicate/concentration sanity
- same source + run spec + seed + engine version reproducibility where the selected libraries support deterministic behavior
- CSV/XLSX logical equivalence

Do not write tests for removed compatibility behavior such as Tauri RPC, sidecar NDJSON, encrypted-DB migration history, AI gateways, donor repair, or legacy synthesis internals.

## UI rules

Keep the interface sparse and task-focused.

The UI should make target semantics explicit, especially denominator and percentage meaning. `+5%p`, `+5% relative`, `25% final share`, and `+5 people` are different requests.

For short text, allow users to inspect response values/frequencies and select values into a reusable `ValueGroup`. Search and simple string-similarity assistance may be added later; semantic auto-classification is not required.

When original replacement is needed, show the consequence before synthesis and let the user choose between the nearest append-only result, approved replacement, or changing the target.

## Packaging

Packaging is part of correctness.

The Electron bundle must include the packaged Python compute executable and its required resources. Verify the installed artifact, not only development mode.

Initial release targets are Windows x64 and Linux x64 unless the contracts are explicitly changed. macOS remains out of initial scope.

## Documentation discipline

When implementation reveals that a v2 contract is wrong, change the contract first or in the same change. Do not preserve obsolete implementation behavior merely because it already exists.

The strongest rule for future complexity is:

> Add a new subsystem only after an actual scenario or benchmark proves that the current dependency-backed pipeline cannot meet the requirement.
