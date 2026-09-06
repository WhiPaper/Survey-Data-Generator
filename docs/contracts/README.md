# Survey Synth — v2 Product & Architecture Contracts

These documents are the authoritative implementation contract for the pre-release v2 rewrite.

## Product in one sentence

Survey Synth is a local-first Electron desktop app that imports Google Form responses, lets the user choose a source scope and final statistical targets, generates plausible candidate responses with a packaged Python compute engine, and selects a final dataset that satisfies those targets with minimal change to the observed data.

## Core invariants

1. Google is the only account provider.
2. Imported source observations and source revisions are immutable evidence.
3. `SourceScope` is frozen into each run and governs all analysis, synthesis, validation, and export for that run.
4. User targets apply to the final dataset.
5. Initial target kinds are `count`, `share`, `mean`, and `conditional_share`.
6. Percentage points, relative percentages, absolute shares, and counts are distinct semantics.
7. Short-text concepts are represented by user-defined `ValueGroup`s, not automatic semantic understanding.
8. Confirmed Form routing, required-question rules, and allowed values are hard constraints. Unknown routing is not invented.
9. Append-only synthesis is attempted first.
10. If append-only cannot reach the target, the system may calculate a minimum original-row replacement plan. Application requires explicit user approval; imported source data itself is never overwritten.
11. Synthetic timestamps are part of the generated row and should remain plausible for the selected source scope.
12. Obvious repeated-row artifacts are not acceptable merely because targets are numerically correct.
13. Default CSV/XLSX exports contain the final survey table without synthetic provenance columns.
14. No LLM/AI feature is part of the v2 plan.
15. The application uses Electron Main for application concerns and a packaged Python process only for heavy compute.
16. The repository is pre-release. Existing development DB/IPC/architecture compatibility is not a product requirement.
17. Prefer mature dependencies over application-owned implementations of general statistics, synthesis, optimization, dataframe, and quality algorithms.

## Runtime

```text
React Renderer
    ↓
Preload / contextBridge
    ↓
Electron Main
    ├─ Google
    ├─ SQLite + Drizzle
    ├─ projects / sources / runs / export
    └─ packaged Python compute job
          ├─ pandas / PyArrow
          ├─ SDV
          ├─ SciPy MILP
          └─ SDMetrics
```

Python is not a daemon and not the app backend.

## Contract map

- `01_PRODUCT_UI.md` — core workflow and UI semantics
- `02_ARCHITECTURE.md` — Electron/Python process architecture
- `03_DOMAIN_MODEL.md` — source scope, targets, runs, edit plans
- `04_GOOGLE_AUTH_IMPORT.md` — Google OAuth and Form import
- `05_FORM_LOGIC.md` — evidence-aware routing and structural validity
- `06_PROFILING_RELATIONSHIPS.md` — prepared features, ValueGroups, quality boundaries
- `07_TARGETS_FEASIBILITY.md` — target math, linear compilation, feasibility
- `08_SYNTHESIS_ENGINE.md` — dependency-backed candidate generation/selection
- `09_PERSISTENCE_LIFECYCLE.md` — clean v2 SQLite schema and immutable history
- `10_EXPORT.md` — final CSV/XLSX semantics
- `12_SECURITY_PRIVACY.md` — practical local-first boundary
- `13_TESTING.md` — scenario/invariant test strategy
- `14_DEPLOYMENT_VERSIONING.md` — Electron + packaged Python deployment
- `15_MONOREPO.md` — repository/dependency boundaries
- `16_MILESTONES.md` — v2 implementation sequence
- `17_DECISIONS.md` — consolidated major decisions

`11_AI_TEXT.md` is intentionally removed because v2 has no AI/LLM plan.

## Authority

Specific topic contracts control their topic. `17_DECISIONS.md` summarizes major decisions and `16_MILESTONES.md` controls implementation sequencing. Existing code is not authoritative when it conflicts with these documents.
