# Survey Synth — Architecture & Product Contracts

This directory is the authoritative implementation contract for the desktop application designed in the preceding product/architecture discussion.

## Product in one sentence

A local-first Tauri desktop app that signs in with Google, lets a user choose an accessible Google Form, analyzes its responses, and expands an original response set to a user-selected final size by generating synthetic additions while preserving the original rows and the important statistical/structural properties of the source data.

## Core product invariants

1. Google is the only account provider.
2. The Google account is the app account/workspace identity.
3. Original responses are immutable.
4. If source size is 50 and target final size is 200, only 150 synthetic rows are created.
5. User targets are expressed against the **final combined dataset**, not only the synthetic portion.
6. Unspecified metrics are preserved automatically as closely as practical.
7. Exact count constraints are hard; percentage/mean targets use the nearest mathematically representable result.
8. Confirmed Google Form routing and required-question rules are respected.
9. Unknown/ambiguous routing is not invented.
10. The normal CSV/XLSX export contains no synthetic provenance columns.
11. Project data is local-first and encrypted at rest.
12. React never receives OAuth refresh tokens, DB keys, or LLM API keys.
13. Business/backend logic is TypeScript; Rust is a thin Tauri/OS/process/security bridge.
14. AI free-text generation is optional and off by default.
15. Public AI functionality must not be enabled until Google OAuth/Limited Use implications of third-party LLM transfer have been reviewed.
16. UI copy and component chrome are intentionally sparse.

## Document map

- `01_PRODUCT_UI.md` — product flow and UI rules
- `02_ARCHITECTURE.md` — process boundaries, RPC, state management
- `03_DOMAIN_MODEL.md` — canonical Form/Response/Profile/Target models
- `04_GOOGLE_AUTH_IMPORT.md` — Google OAuth, Drive/Forms acquisition
- `05_FORM_LOGIC.md` — reachability and branching evidence model
- `06_PROFILING_RELATIONSHIPS.md` — profiling, semantic inference, relationship analysis
- `07_TARGETS_FEASIBILITY.md` — user targets, compiler, feasibility equations
- `08_SYNTHESIS_ENGINE.md` — resampling, mutation, repair, validation
- `09_PERSISTENCE_LIFECYCLE.md` — SQLite ownership, revisions, project lifecycle
- `10_EXPORT.md` — CSV/XLSX contract
- `11_AI_TEXT.md` — optional LLM-based free-text generation
- `12_SECURITY_PRIVACY.md` — security and privacy boundary
- `13_TESTING.md` — test strategy and quality gates
- `14_DEPLOYMENT_VERSIONING.md` — installers, sidecar packaging, updates and versions
- `15_MONOREPO.md` — packages, imports and dependency rules
- `16_MILESTONES.md` — implementation milestones
- `17_DECISIONS.md` — consolidated architecture decisions

## Authority rule

When an earlier idea conflicts with a later decision recorded here, the **later contract reflected in these documents wins**. These documents intentionally omit superseded alternatives.
