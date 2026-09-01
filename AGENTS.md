# AGENTS.md

## Purpose

This repository is implemented against an existing, explicit product and architecture contract.

The contract documents live under:

```text
docs/contracts/
```

Treat those documents as **authoritative implementation requirements**, not optional design notes.

Your job is to implement the current milestone faithfully, preserve the documented architecture and product invariants, and avoid speculative complexity.

---

## 1. Read the contracts before changing code

Before starting a task:

1. Read `docs/contracts/README.md`.
2. Read `docs/contracts/17_DECISIONS.md`.
3. Read `docs/contracts/16_MILESTONES.md`.
4. Read the contract document(s) directly relevant to the requested work.
5. Inspect the existing code and tests before proposing changes.

Relevant contract map:

```text
01_PRODUCT_UI.md
02_ARCHITECTURE.md
03_DOMAIN_MODEL.md
04_GOOGLE_AUTH_IMPORT.md
05_FORM_LOGIC.md
06_PROFILING_RELATIONSHIPS.md
07_TARGETS_FEASIBILITY.md
08_SYNTHESIS_ENGINE.md
09_PERSISTENCE_LIFECYCLE.md
10_EXPORT.md
11_AI_TEXT.md
12_SECURITY_PRIVACY.md
13_TESTING.md
14_DEPLOYMENT_VERSIONING.md
15_MONOREPO.md
16_MILESTONES.md
17_DECISIONS.md
```

Do not rely on memory or infer a new architecture when the contracts already define the answer.

---

## 2. Contract precedence

Use the following rules:

1. A specific topic contract controls the detailed implementation of that topic.
2. `17_DECISIONS.md` controls architectural intent and major decisions.
3. `16_MILESTONES.md` controls implementation sequencing and scope.
4. `README.md` controls global invariants and the authority model.

If two documents appear to directly conflict:

- do not silently choose one,
- do not code around the conflict,
- identify the conflicting clauses,
- explain the smallest decision required before proceeding.

Do not change a documented contract merely because another implementation would be easier.

---

## 3. Core invariants that must never be violated

These are non-negotiable unless the user explicitly changes the contract.

### Product/data invariants

- Google is the only account provider.
- Google `sub` is the stable account identity; email is display data.
- Original responses are immutable.
- Augmentation only creates synthetic additions.
- User targets apply to the **final combined dataset**, not just synthetic rows.
- Exact count targets are hard constraints.
- Ratio/mean targets use the nearest mathematically representable result.
- Unspecified metrics are preserved automatically; they are not hidden user constraints.
- Preserve `answered`, `skipped`, `not_reached`, and `indeterminate` as distinct internal states.
- Never invent a Google Form path when routing evidence is ambiguous.
- Branch-driving mutations are structural operations, not single-cell edits.
- Default CSV/XLSX exports do not expose synthetic provenance.
- A saved Run is immutable with respect to its source revision, target snapshot, seed, and engine/profile versions.

### Architecture invariants

- Business/backend logic is TypeScript.
- Rust is a thin Tauri/OS/process/security bridge.
- The TypeScript sidecar owns project SQLite.
- React never accesses SQLite directly.
- React never calls Google APIs directly.
- React never calls an LLM provider directly.
- React never receives OAuth refresh/access tokens, DB keys, or LLM API keys.
- Large response datasets do not bounce through React IPC.
- The sidecar uses stdout for NDJSON protocol only; logs go to stderr.
- Concrete optimization libraries do not leak into `synthesis-core`.
- Google SDK, SQLite, Tauri, React, and solver implementations do not leak into `domain`.

### Privacy/security invariants

- Project data is local-first.
- Local project SQLite is encrypted at rest.
- Refresh tokens, DB key material, and optional LLM keys live in `SecureSecretStore`.
- Raw survey responses, secrets, and prompts must not appear in production logs.
- Uploaded Google Drive file bytes are not downloaded for this product.
- AI free-text generation is optional and off by default.
- AI OFF means zero LLM network calls.
- Public AI functionality remains gated until the applicable Google OAuth/Limited Use requirements have been reviewed.
- No automatic telemetry containing survey data.
- No automatic cloud backup/sync of project data.

---

## 4. Work only on the current milestone

Follow `16_MILESTONES.md`.

Do not implement future milestones “while you are here” unless the current task explicitly requires a small prerequisite.

Examples of prohibited scope creep:

- adding AI infrastructure during M2,
- adding generic provider abstractions when Google-only auth is contracted,
- building cloud sync because persistence code is being touched,
- implementing multiple release channels before required,
- building advanced solver abstractions before the current synthesis milestone needs them.

Prefer the smallest implementation that fully satisfies the current milestone contract and leaves the documented extension points intact.

### Milestone gate rule

A milestone is not complete because the feature appears to work manually.

It is complete only when:

- the milestone acceptance criteria are met,
- relevant automated tests pass,
- architecture/import boundaries pass,
- known contract invariants remain true,
- packaged-runtime tests are included where the milestone requires packaging validation.

Do not move to the next milestone while a current milestone acceptance criterion is knowingly broken.

---

## 5. Refactoring policy

At the end of a milestone, perform a **targeted refactoring review**, not a blanket rewrite.

Refactor only when it removes real technical debt such as:

- duplicated domain/business logic,
- violated package boundaries,
- persistence/transport concerns leaking into core logic,
- test-hostile coupling,
- unclear responsibility that blocks the next milestone,
- repeated ad-hoc metric calculations that should share one canonical definition.

Do not refactor merely to introduce:

- generic BaseService classes,
- speculative provider systems,
- unused Repository layers,
- generic “shared/common/utils” dumping grounds,
- factories/DI frameworks with no current need,
- future-facing plugin systems,
- wrappers that only rename an existing API.

Before risky refactors, add or strengthen tests that preserve current behavior.

A refactor must not change product behavior or documented contracts unless the task explicitly includes a contract change.

---

## 6. Monorepo dependency rules

Follow `15_MONOREPO.md`.

Expected high-level structure:

```text
apps/
  desktop/
  sidecar/

packages/
  domain/
  contracts/
  statistics/
  synthesis-core/
  test-support/

src-tauri/
tests/
scripts/
```

Allowed dependency direction:

```text
domain
  ↑
  ├─ contracts
  │    ↑
  │    ├─ desktop
  │    └─ sidecar
  │
  ├─ statistics
  │
  └─ synthesis-core
       ↑
     sidecar
```

### Forbidden imports

`packages/domain/**` must not import:

- `apps/**`
- React
- Tauri
- Zod
- Google SDKs
- SQLite implementations
- HiGHS/solver implementations
- Node filesystem/worker infrastructure

`packages/statistics/**` must not import:

- sidecar infrastructure
- desktop
- SQLite
- Google SDKs
- synthesis orchestration

`packages/synthesis-core/**` must not import:

- sidecar implementation
- SQLite implementation
- Google implementation
- React/Tauri
- a concrete solver backend

`apps/desktop/**` must not import:

- sidecar source
- SQLite
- Google SDKs
- solver implementations
- Node filesystem APIs

Production code must never import `packages/test-support`.

Do not create a generic `packages/shared`, `packages/common`, or `packages/utils` without an explicit contract change.

Use package public exports; do not import private internal source paths across package boundaries.

---

## 7. Implementation style

### TypeScript

Prefer:

- explicit domain types,
- discriminated unions,
- small pure functions for domain/statistical transformations,
- typed ports at infrastructure boundaries,
- immutable inputs for synthesis/profiling where practical,
- deterministic seeded behavior in structured synthesis.

Avoid:

- `any`,
- broad `unknown` patches without validation,
- business behavior encoded in React components,
- SQL scattered outside persistence modules,
- transport DTOs becoming domain models by accident.

Runtime validation belongs at boundaries, primarily in `contracts`.

### Rust

Keep Rust intentionally small.

Rust may own:

- sidecar process lifecycle,
- opaque RPC forwarding,
- secure OS credentials,
- opener/dialog/path capabilities,
- Tauri capability enforcement.

Do not recreate Question/Target/Profile/Synthesis business models in Rust.

### Persistence

Repositories/application services own persistence access.

Do not let UI components issue SQL.

Do not silently replace a failed/migration-incompatible DB with an empty DB.

Source revisions and historical Runs are append-oriented and reproducible.

---

## 8. UI implementation rules

Follow `01_PRODUCT_UI.md`.

The interface is intentionally sparse.

Before adding a visible element, ask whether it materially helps the user complete the task or understand an important consequence.

Do not add:

- generic page descriptions,
- redundant helper text,
- “automatic” badges for values that are simply derived,
- a Card around every question/item,
- default charts for every metric,
- duplicate navigation/actions,
- decorative dashboards/KPI blocks,
- generic success marketing copy.

Prefer:

- typography,
- spacing,
- alignment,
- separators,
- progressive disclosure.

Use shadcn/ui as an interaction/design-system primitive library, not as a mandate to maximize component count.

### Important target editor rule

Display unit and target semantic are different.

Switching `%` → `명` for display does **not** convert a ratio constraint into a count constraint.

Only editing the count value changes the semantic constraint type.

Auto-derived values are text, not fake editable fields.

Reset removes the explicit constraint.

### Autosave

No visible Save button.

Persist valid drafts with debounce/revision control and flush before:

- project/account switch,
- navigation,
- window close,
- synthesis start.

---

## 9. Synthesis and statistical implementation rules

Follow `06_PROFILING_RELATIONSHIPS.md`, `07_TARGETS_FEASIBILITY.md`, and `08_SYNTHESIS_ENGINE.md`.

Canonical pipeline:

```text
ProjectTargets
→ TargetCompiler
→ FeasibilityChecker
→ FeatureCompiler
→ WeightOptimizer
→ RowAllocator
→ Structural/Value Mutation
→ GlobalRepair
→ DeferredFieldGenerator
→ Validator
```

Never optimize directly against an ad-hoc metric definition that disagrees with the Validator.

Solver and Validator must share canonical FeatureSpace/metric semantics.

### Preservation

Selection statistic and preservation feature are not necessarily the same.

Example:

- Cramér's V can select an important categorical relationship.
- Solver preservation should generally use selected joint-cell/interaction features rather than trying to optimize Cramér's V directly.

### Priorities

Respect semantic priority ordering:

```text
form_hard
user_exact
user_approx
user_range
preserve_marginal
preserve_relationship
preserve_temporal
diversity
```

Do not improve a lower-priority objective by violating a higher-priority one.

### Structural mutation

Never flip a branch answer without repairing reachability.

No donor support, restart ambiguity, or unsupported routing means the unsafe structural mutation is rejected.

### AI

AI is deferred until structured synthesis is valid.

LLM failure must not corrupt valid structured synthetic rows.

---

## 10. Testing requirements

Follow `13_TESTING.md`.

For any behavioral change:

- add or update tests at the lowest useful layer,
- test invariants rather than only implementation details,
- avoid relying solely on UI/E2E tests.

Critical invariants to test continuously:

```text
original mutation count = 0
final row count is correct
exact targets are exact
range targets stay within range
approx targets are nearest feasible
confirmed branch contradictions = 0
confirmed required violations = 0
same structured input + seed + engine version is reproducible
default export exposes no provenance
AI OFF causes no LLM calls
```

Use property-based tests where the contract calls for them.

Use benchmark/regression fixtures for statistical quality rather than a user-facing “preservation score”.

### Before declaring a task complete

Run the repository's existing:

- format/lint checks,
- typecheck,
- unit/integration tests relevant to the change,
- dependency-boundary checks,
- milestone-specific smoke tests.

Inspect `package.json`/workspace configuration and use the repository's actual commands. Do not invent command names if scripts already exist.

---

## 11. Packaging is part of correctness

Do not assume code that works in dev works in production packaging.

The product must ship without requiring the end user to install Node.js.

For packaging-sensitive work, verify the real packaged artifact where applicable:

- sidecar launches,
- RPC handshake works,
- encrypted SQLite opens,
- migrations work,
- Worker Threads load,
- optimization backend loads,
- CSV/XLSX export works.

`@yao-pkg/pkg` is not a mandatory architecture choice. The contract is a self-contained user experience. Change packaging implementation if required by native dependency reliability, without changing process architecture.

---

## 12. Security and logging discipline

Never print or persist secrets for debugging.

Do not log:

- refresh/access tokens,
- DB keys,
- LLM keys,
- raw survey answers,
- raw free-text responses,
- full LLM prompts/responses.

When diagnostic correlation is needed, use safe counts/codes or hashed identifiers.

Temporary files must be cleaned on success, failure, cancel, and startup orphan cleanup.

Destructive operations must follow the product's confirmation rules.

---

## 13. Handling uncertainty

Do not guess when the repository or contract can answer the question.

If implementation reveals a genuinely missing contract:

1. isolate the exact missing decision,
2. explain why existing contracts do not decide it,
3. provide the smallest practical options,
4. avoid implementing speculative behavior until resolved if the choice would change product semantics.

For minor implementation details that do not affect contracts, choose the simplest maintainable option and continue.

---

## 14. Documentation changes

Do not casually rewrite contract documents during feature implementation.

Update `docs/contracts/` only when:

- the user explicitly changes a contract, or
- implementation exposes a necessary contract correction and that change has been approved.

When a contract changes:

- update the relevant specific document,
- update `17_DECISIONS.md` if it changes a major decision,
- update `16_MILESTONES.md` if sequencing/acceptance changes,
- update tests to enforce the new contract.

Code and contract must not intentionally diverge.

---

## 15. Definition of done for an agent task

A task is done when all applicable items are true:

- requested behavior is implemented,
- current milestone scope is respected,
- architecture/import boundaries remain valid,
- relevant tests are added/updated and pass,
- security/privacy invariants remain valid,
- no unnecessary abstraction or UI chrome was added,
- no unrelated future milestone was implemented,
- no existing project data/reproducibility contract was broken,
- comments/TODOs do not hide unfinished required behavior,
- the final summary clearly states:
  - what changed,
  - tests/checks run,
  - any remaining contract-relevant risk.

If a required check could not be run, say so explicitly. Do not claim completion based on assumption.
