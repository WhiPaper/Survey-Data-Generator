# Implementation Milestones

## M0 — Scaffold

Goal: prove all process boundaries.

Deliver:

- pnpm workspace
- Tauri + React shell
- TS sidecar
- NDJSON hello/handshake
- React → Rust → sidecar round-trip
- crash handling skeleton
- shared contracts
- lint/typecheck/unit CI
- dependency-boundary enforcement

Do not start Google/DB feature scope before the process skeleton is reliable.

## M1 — Google login / account

Deliver:

- desktop OAuth
- PKCE
- loopback callback
- Google `sub` identity
- SecureSecretStore
- refresh/access lifecycle
- single-flight refresh
- reauth handling
- multiple saved Google accounts
- switch/logout/revoke semantics

Done when app restart restores a valid session without exposing tokens to React.

## M2 — Form import

Deliver:

- Drive Form listing/search
- Shared Drive direction
- forms.get
- responses pagination
- normalization
- FormLogic
- PathResolver
- answer-state inference
- unsupported question handling
- 0-response/permission errors

Done when a real/mock Form can be selected and normalized with full paginated responses.

## M3 — Local project / profiler

Deliver:

- encrypted SQLite
- repositories
- migrations
- source revision #1
- response versions
- QuestionProfiler
- semantic inference
- RelationshipAnalyzer
- project reopening without Google calls

Done when app restart opens the project entirely from local storage.

## M4 — Basic synthesis

Start narrow:

- SingleChoice
- Ordinal/rating
- Numeric
- response timestamp

Deliver:

- TargetCompiler
- static feasibility
- FeatureCompiler
- OptimizationBackend
- HiGHS adapter
- WeightOptimizer
- RowAllocator
- basic mutation
- validator
- seeded reproducibility

This is the first technical go/no-go gate.

Acceptance:

- source immutable
- exact counts exact
- ratios/means nearest feasible
- no-target preservation acceptable
- infeasible targets caught
- same seed reproducible

## M5 — Target Editor

Deliver UI and editing semantics for:

- single choice
- checkbox
- ordinal
- numeric
- date/time
- free-text strategy
- file policy
- grid
- detailed goals

Deliver:

- AllocationInput
- `% / 명` semantic distinction
- reset removes constraint
- semantic ambiguity handling
- autosave and target revision
- inline feasibility errors

## M6 — Advanced synthesis

Deliver:

- checkbox co-occurrence
- selection-count distribution
- relationship preservation
- conditional goals
- grid relationships
- date/time relationships
- missingness preservation
- GlobalRepair MIP
- duplicate minimization
- structural mutation
- branch-aware donor selection

Second go/no-go gate.

Acceptance:

- relationship regression benchmarks
- branch contradictions zero where evidence is confirmed
- required violations zero
- ambiguous routing not invented
- user targets dominate preservation priorities

## M7 — Source refresh / revisions

Deliver:

- 새 응답 가져오기
- schema hash/diff
- response content hashes
- response versioning
- source revisions
- target migration
- semantic override migration

Acceptance:

- old Run remains bound to old source
- new source revision can become current
- breaking target changes not silently discarded
- final target N remains user-owned
- feasibility reruns after source update

## M8 — Export

Deliver:

- shared export schema
- CSV streaming
- XLSX
- grid flatten
- typed date/time/numeric cells
- formula-injection safety
- save dialog
- project timezone

This milestone forms a complete non-AI v1 product.

## M9 — Optional AI free text

Deliver:

- LlmGateway
- secure credential
- PII detector/redactor
- context selector
- batching
- prompt builder
- validation
- retries/fallback
- persisted generated text

Keep public feature gated until current Google policy review permits the actual third-party data flow.

## M10 — Security / release hardening

Deliver/verify:

- encrypted DB release implementation
- secure deletion
- safe logging
- temp cleanup
- account/project delete
- tight Tauri capabilities/CSP
- sidecar packaging
- Windows/macOS/Linux installers
- code signing
- macOS notarization
- updater signing
- migration backup/recovery
- privacy/support web pages
- Google OAuth verification readiness

Public release requires M10.

## Implementation order before feature work

Recommended initial spike sequence:

```text
1. pnpm monorepo
2. React + Tauri shell
3. TS sidecar hello RPC
4. shared contracts
5. dependency boundary lint
6. secure host capability skeleton
7. encrypted SQLite packaging spike
8. HiGHS/worker packaging spike
9. packaged sidecar installation spike
10. Google OAuth
```

The main early packaging risk is the combination of:

```text
encrypted SQLite native dependency
+
HiGHS/WASM
+
Worker Thread
+
self-contained TypeScript sidecar
+
Tauri installer
```

Prove it before investing heavily in UI polish.
