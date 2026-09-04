# Consolidated Architecture Decisions

This file records the most important decisions so an implementation agent can quickly recover the intent.

## ADR-001 — Google-only identity

**Decision:** Google is the permanent sole auth provider. Use `google_accounts`, Google `sub`, and no provider abstraction.

**Why:** no provider expansion is planned; generic auth would be unused abstraction.

## ADR-002 — TypeScript owns business/backend logic

**Decision:** React and long-running TS sidecar contain application/domain behavior. Rust remains a thin Tauri/OS/security/process host.

**Why:** preserve TypeScript implementation preference and avoid business DTO duplication.

## ADR-003 — TS sidecar owns SQLite

**Decision:** project SQLite is opened/read/written by the TS sidecar, not React/Tauri SQL.

**Why:** response/profile/solver/export data already lives in TS and should not bounce through IPC.

## ADR-004 — Database encrypted by default

**Decision:** local project SQLite is encrypted at rest; root key is protected by SecureSecretStore.

**Why:** source surveys may contain PII and free text.

## ADR-005 — Local-first project snapshots

**Decision:** projects use immutable local SourceRevisions and do not auto-refresh from Google on open.

**Why:** reproducibility, offline access, performance, external API independence.

## ADR-006 — Original rows are immutable

**Decision:** synthetic augmentation only adds rows.

**Why:** core product promise and simplifies mathematical contracts.

## ADR-007 — Targets apply to final dataset

**Decision:** targets include original constant contribution + synthetic contribution.

**Why:** matches user intent (“make final 200 people 55% female”).

## ADR-008 — Unspecified targets are preservation objectives

**Decision:** no explicit preserve-mode controls.

**Why:** omission is the natural default and reduces UI state.

## ADR-009 — Exact count vs percentage semantics remain distinct

**Decision:** count is hard exact; percentage/mean resolves to nearest feasible value. Changing display unit alone does not change semantic target type.

## ADR-010 — Evidence-aware missingness

**Decision:** preserve `answered`, `skipped`, `not_reached`, `indeterminate`.

**Why:** Forms API does not expose complete path history; ambiguity must not be fabricated.

## ADR-011 — Grids are groups of normal row questions

**Decision:** no special giant grid solver type.

**Why:** reuse core SingleChoice/MultiChoice algorithms while giving UI a group abstraction.

## ADR-012 — Statistical selection metric ≠ preservation feature

**Decision:** e.g. Cramér's V selects a relationship; joint features preserve it.

**Why:** effect-size diagnostics are not generally linear solver objectives.

## ADR-013 — Synthesis pipeline

**Decision:**

```text
weighted resampling
→ constrained mutation
→ global repair
→ validation
```

Use optimization abstraction; initial candidate HiGHS.

## ADR-014 — Branch mutation is structural

**Decision:** changing branch-driving values requires reachability repair and compatible donor initialization.

**Why:** flipping one answer alone can create impossible rows.

## ADR-015 — `indeterminate` rows are not structural mutation material

**Decision:** resample observed uncertainty but do not invent new routing behavior in ambiguous areas.

## ADR-016 — AI free text is deferred and optional

**Decision:** structured synthesis completes first. AI is off by default and failure is isolated.

## ADR-017 — No synthetic provenance in normal export

**Decision:** internal origin/template/run metadata is retained in SQLite but not in default CSV/XLSX.

## ADR-018 — Export uses one logical schema

**Decision:** CSV/XLSX are representations of the same saved Run, not separate synthesis paths.

## ADR-019 — Sparse shadcn UI

**Decision:** reuse shadcn interaction primitives without card/badge/component inflation.

## ADR-020 — Autosave, no visible Save button

**Decision:** valid target draft autosaves with optimistic revision control and flushes before synthesis/navigation.

## ADR-021 — AI third-party transfer is a release gate

**Decision:** public AI feature remains gated until current Google OAuth/Limited Use requirements are reviewed for the implemented external transfer.

## ADR-022 — Self-contained sidecar is the contract, not a packaging tool

**Decision:** end users need no Node install. `@yao-pkg/pkg` may be tested first, but packaging strategy can change if native SQLite/worker support requires it.

## ADR-023 — Host/sidecar versions match exactly

**Decision:** host and sidecar ship as one app, so no cross-version protocol compatibility layer. User DB is the component that supports migrations.

## ADR-024 — Stable release channel only initially

**Decision:** no user-facing beta/nightly channel complexity.

## ADR-025 — Generic shared/utils package is avoided

**Decision:** code belongs to the package that owns its meaning; dependency boundaries are enforced in CI.

## ADR-026 — Legacy export is evidence-gated

**Decision:** migrations preserve pre-v8/pre-v9 records, but historical export is supported only when a valid persisted project timezone and a non-null frozen semantic-override snapshot are available. Missing values return typed `LEGACY_COMPATIBILITY_REQUIRED`; current OS timezone and current semantic overrides are never substituted.

**Why:** export must not silently change historical semantics, and the old schemas did not persist enough information to reconstruct every Run.

## ADR-027 — macOS excluded from initial release packaging targets

**Decision:** exclude macOS DMG/app bundles from release targets and CI packaging matrix, focusing release installers on Windows (x64 NSIS) and Linux (x64 AppImage).

**Why:** macOS desktop distribution outside the Mac App Store mandates an active paid Apple Developer Program membership ($99/year), Developer ID Application signing certificates, and Apple Notarization (`notarytool`); without these, Gatekeeper blocks downloaded apps as damaged/untrusted.

## ADR-028 — Google profile photo is display metadata

**Decision:** Read the optional HTTPS `picture` claim from Google userinfo, persist it as `avatarUrl`, and expose it through account/session views for the account footer. Never use it as identity; Google `sub` remains the stable account key.

**Why:** The desktop account switcher can represent the signed-in Google account without introducing another provider or credential flow. Missing, invalid, or stale image URLs fall back to initials.
