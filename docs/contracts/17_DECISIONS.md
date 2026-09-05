# Consolidated v2 Architecture Decisions

This file is the fast recovery point for the major v2 decisions.

## ADR-001 — Google-only identity

Use Google `sub` as the stable account identity. Do not build a generic auth-provider abstraction.

## ADR-002 — Electron replaces Tauri/Rust/sidecar

The desktop runtime is React Renderer + Preload + Electron Main. There is no Rust host, Tauri bridge, or long-running TypeScript sidecar in v2.

## ADR-003 — Python is a packaged compute job, not the backend

Electron Main owns application/product behavior. Python performs one heavy compute job and exits. Use JSON for job metadata and Parquet for row tables.

## ADR-004 — Dependency-backed computation

General tabular synthesis, optimization, dataframe handling, and statistical quality are delegated first to SDV, SciPy, pandas/PyArrow, and SDMetrics.

Application code should not reimplement these responsibilities without benchmark evidence that the dependency-backed approach fails a product requirement.

## ADR-005 — Clean pre-release persistence rewrite

The program has not been distributed. Current development DB schemas and IPC contracts have no compatibility requirement.

Use a clean Drizzle/better-sqlite3 schema starting at `0001`. No legacy importer or old migration chain is required.

## ADR-006 — Plain SQLite in v2

Database encryption is not a v2 requirement. Google refresh tokens still use OS secure credential storage; access tokens remain in memory.

Do not claim encrypted-at-rest protection.

## ADR-007 — Immutable imported evidence

Source observations and SourceRevisions are immutable. Historical runs remain tied to their exact source evidence.

## ADR-008 — SourceScope is a first-class frozen input

Every run freezes the source revision plus its response filter (`all` or submitted-time range), response count, and response-set hash.

Analysis, target calculation, synthesis, validation, and export must use that same frozen scope.

## ADR-009 — Targets apply to the final dataset

Targets are evaluated over kept source-derived rows + approved replacements + synthetic additions.

## ADR-010 — Initial target surface is intentionally small

Initial public target kinds are:

```text
count
share
mean
conditional_share
```

Do not build a general target DSL.

## ADR-011 — Target semantics are explicit

Absolute share, percentage-point change, relative percentage change, exact count, and count delta are different semantics. UI must resolve the meaning before execution.

## ADR-012 — ValueGroup is manual product meaning

A ValueGroup stores the raw values the user intentionally grouped together. It is not an automatic semantic classifier.

`과일={사과,오렌지}` and `부산={부산,부산시}` are user definitions. Search/string-similarity assistance may be added later without changing the optimizer contract.

## ADR-013 — Derived features are the extension boundary

User/product concepts compile into small numeric/boolean row features. New target scenarios should usually extend feature/target compilation rather than create new synthesis algorithms.

## ADR-014 — Evidence-aware Form logic remains

Keep `answered`, `skipped`, `not_reached`, and `indeterminate` distinct. Confirmed routing/required/allowed-value rules are hard. Unknown routing is never invented.

## ADR-015 — No donor/mutation/repair synthesis architecture

The engine generates complete candidate rows and hard-validates them. v2 does not use branch donor selection, structural cell mutation, or global repair as its canonical pipeline.

## ADR-016 — SDV generates candidate rows

Start with `GaussianCopulaSynthesizer` and model response timestamp as part of the row where supported.

Only change/grow the generation subsystem after representative benchmarks show a concrete failure.

## ADR-017 — SciPy MILP selects candidates

Use `scipy.optimize.milp` for candidate selection, feasibility, and replacement-enabled solving.

Do not use CVXPY or a direct HiGHS abstraction initially; SciPy already provides the needed MILP boundary.

## ADR-018 — Append-only first, approved replacement second

The default solve keeps all source-derived rows.

If append-only is infeasible or the user explicitly compares alternatives, a second solve may calculate the minimum number of source-derived rows that must be replaced.

No replacement is applied without explicit user approval.

## ADR-019 — Original replacement is complete-row replacement first

v2 replacement candidates are complete plausible rows. Do not build cell-level edit distance/mutation systems initially.

Imported observations themselves are never overwritten.

## ADR-020 — Timestamp plausibility is core; custom temporal modeling is not

Synthetic timestamps must be valid/plausible for the frozen source scope. Start with SDV datetime modeling and quality checks.

Do not build inter-arrival/KDE/burst/time-series subsystems until benchmark evidence requires them.

## ADR-021 — Avoid obvious row-copy artifacts

Target correctness alone is insufficient. Use generated candidate diversity plus simple duplicate/concentration diagnostics and SDMetrics before creating a custom diversity optimizer.

## ADR-022 — SDMetrics is quality, not correctness

SDMetrics handles general synthetic-data fidelity diagnostics. Survey Synth separately hard-validates final count, target outcomes, Form logic, allowed values, frozen scope, and approved EditPlan.

## ADR-023 — No custom relationship analyzer in the core pipeline

Do not make Pearson/Spearman/Cramér's V/relationship selection a synthesis prerequisite. Candidate generation learns ordinary joint structure; add product-specific metrics only when a concrete scenario needs them.

## ADR-024 — No LLM/AI plan

v2 contains no OpenAI/LLM provider, semantic LLM classification, AI-generated free text, AI keys, or AI transfer UI.

## ADR-025 — High-cardinality free text is not authored automatically

Low-cardinality repeated short text may be categorical. High-cardinality free text uses observed/user-provided values or blank/reuse behavior as appropriate; v2 does not invent prose.

## ADR-026 — Default export hides provenance

Normal CSV/XLSX exports contain the final survey-response table and not origin/run/candidate/replacement metadata.

## ADR-027 — Sparse UI and autosave remain

Keep the UI task-focused, use progressive disclosure, and autosave valid drafts. Surface denominator/target ambiguity and original-replacement consequences explicitly.

## ADR-028 — Stable boundaries, not speculative abstractions

Extensibility comes from stable inputs/outputs around:

```text
prepare
→ generate
→ compile/select
→ evaluate
```

Do not create plugin systems, provider registries, generator class hierarchies, optimizer interfaces, or generic shared packages solely for hypothetical future needs.

## ADR-029 — Initial packaging targets

Ship one Electron bundle including the packaged Python engine. Initial release targets are Windows x64 and Linux x64. End users install neither Node nor Python.

## ADR-030 — Complexity gate

A new custom subsystem requires an actual scenario or benchmark showing the current dependency-backed pipeline cannot meet the product requirement.
