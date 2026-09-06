# Architecture Contract

## Process architecture

```text
React Renderer
      │
      │ narrow preload API
      ▼
Electron Main
  ├─ Google OAuth / Forms / Drive
  ├─ SQLite + Drizzle
  ├─ projects / source revisions / targets / runs
  ├─ export
  ├─ jobs
  └─ Python compute process
        │
        ├─ job.json
        ├─ source.parquet
        ▼
Packaged Python Engine
  ├─ prepare
  ├─ generate
  ├─ select
  └─ evaluate
        │
        ├─ result.parquet
        └─ report.json
```

There is no Rust host, Tauri bridge, Node sidecar, NDJSON backend protocol, or long-running Python daemon in v2.

## Renderer

Owns:

- rendering
- user interaction
- target editing draft
- lightweight view state
- query cache

Must not own:

- SQLite
- direct Google APIs
- OAuth tokens
- filesystem/process primitives
- Python execution
- synthesis/statistical logic

Use `contextIsolation: true`, `nodeIntegration: false`, and a narrow preload API.

## Electron Main

Owns application/product concerns:

- Google account/session lifecycle
- Form listing/import/refresh
- source revision creation
- local persistence
- target drafts and run orchestration
- job registry
- process spawn/cancel
- export
- OS dialogs/paths/secure credential storage

Prefer product-oriented functions over service/factory hierarchies.

## Python compute engine

Python owns heavy tabular compute only.

It must not own:

- Google OAuth
- project persistence
- UI state
- account/session behavior
- file dialogs
- long-lived application state

Default execution model:

```text
survey-synth-engine synthesize --job job.json
```

The process validates inputs, performs one job, writes outputs, and exits.

## Transport

Use:

- JSON for configuration, metadata, progress events, and report summaries
- Parquet for response/candidate/result tables

Do not move large row datasets through renderer IPC.

Small progress messages may be emitted on stdout as structured JSON lines. Logging goes to stderr. This is not a general request/response RPC protocol.

## Cancellation

A running compute job has a durable application-level job record independent of renderer request lifetime.

Cancellation may terminate the Python child process and mark the job cancelled. Partial result files are never promoted to a completed Run.

## Frontend state

Use:

- TanStack Query for persisted/application state views
- React Hook Form for target editing drafts
- local component state for ephemeral UI

Do not add Redux/Zustand unless a demonstrated state-management problem requires it.

## Error categories

Prefer a small product-facing error set:

```text
UNAUTHENTICATED
REAUTH_REQUIRED
PERMISSION_DENIED
NOT_FOUND
VALIDATION_FAILED
TARGET_INFEASIBLE
JOB_CANCELLED
COMPUTE_FAILED
EXPORT_FAILED
INTERNAL
```

Target infeasibility is normally a successful compute/planning outcome with diagnostics, not an unexpected exception.

## Extension rule

Future computation may replace SDV, SciPy, or timestamp generation internally, but the application-facing compute job contract should remain table/config/result oriented.

Do not introduce a plugin system or generic backend protocol to prepare for hypothetical future engines.
