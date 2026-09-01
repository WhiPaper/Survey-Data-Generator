# Architecture Contract

## Process architecture

```text
React / TypeScript UI
        │
        │ Tauri invoke
        ▼
Thin Rust Host / Backend Bridge
        │
        │ stdin/stdout NDJSON
        ▼
Long-running TypeScript Sidecar
   ├─ Google OAuth/API
   ├─ Encrypted SQLite
   ├─ profiling
   ├─ relationship analysis
   ├─ feasibility
   ├─ synthesis
   ├─ optional AI
   └─ export
```

## Responsibility boundaries

### React

Owns:

- rendering
- user interaction
- TanStack Query cache
- React Hook Form editing draft
- lightweight view-state

Must not own:

- Google tokens
- direct Google API calls
- SQLite
- synthesis/statistics logic
- raw filesystem access
- LLM credentials

### Rust/Tauri host

Owns only boundary capabilities:

- sidecar spawn/lifecycle
- opaque request correlation
- system browser opener
- secure secret store integration
- save dialogs / app paths where needed
- Tauri capability boundary

Rust does **not** mirror business DTOs such as QuestionTarget or RelationshipProfile.

### TypeScript sidecar

Owns:

- account/session application logic
- Google Drive/Forms acquisition
- normalization
- SQLite repositories and migrations
- profiling and relationship analysis
- target compilation/feasibility
- synthesis
- optional AI subsystem
- export

## IPC

Rust exposes a generic opaque backend bridge rather than one Rust command per business action.

Shared TypeScript package `packages/contracts` defines runtime-validated RPC DTOs.

Example map:

```ts
interface BackendRpc {
  "session.get": {
    input: void
    output: SessionView | null
  }

  "forms.list": {
    input: { query?: string; cursor?: string }
    output: {
      items: FormListItem[]
      nextCursor?: string
    }
  }

  "projects.get": {
    input: { projectId: ProjectId }
    output: ProjectView
  }
}
```

The frontend uses a typed generic call function.

## Sidecar protocol

Long-running sidecar. stdin/stdout NDJSON.

Request:

```json
{"v":1,"type":"request","id":"r_123","method":"forms.list","params":{}}
```

Responses are structured success/error messages.

Rules:

- stdout is protocol JSON only.
- logs go to stderr.
- long jobs emit small events rather than large row payloads.
- raw datasets do not cross to React.

Handshake includes:

```ts
interface SidecarReady {
  type: "ready"
  appVersion: string
  protocolVersion: number
  databaseSchemaVersion: number
  domainSchemaVersion: number
  engineVersion: number
  profilerVersion: number
}
```

Host and sidecar app/protocol versions are exact-match.

## Jobs

Short operations are request/response:

- session.get
- forms.list
- projects.list/get
- targets.save

Long operations are jobs:

- project import/profiling
- synthesis
- large export
- optional AI generation

Events:

- `job.progress`
- `job.completed`
- `job.failed`

Jobs support cancel via `AbortController`.

Heavy profiling/optimization/synthesis runs in Node Worker Threads so the main RPC loop remains responsive.

Start with one heavy worker unless real measurements justify more.

## Crash behavior

If sidecar crashes:

- pending calls fail with `BACKEND_UNAVAILABLE`
- host may restart once
- no half-committed domain transaction should survive
- UI remains able to present a short recoverable error

Shutdown:

1. request clean shutdown
2. close/checkpoint DB
3. terminate sidecar if clean exit fails

## Backend errors

Structured codes:

```text
UNAUTHENTICATED
REAUTH_REQUIRED
PERMISSION_DENIED
NOT_FOUND
VALIDATION_FAILED
TARGET_CONFLICT
GOOGLE_API_ERROR
RATE_LIMITED
JOB_CANCELLED
BACKEND_UNAVAILABLE
INTERNAL
```

Statistical infeasibility is not a backend exception; it returns a `FeasibilityReport`.

## Frontend state

Use:

- TanStack Query v5 — backend/local persisted state
- React Hook Form — target editing draft
- Zod — frontend/runtime validation
- local `useState` — ephemeral UI
- `useFieldArray` — dynamic targets/goals
- Tauri events + custom hook — long job status

Do not add Redux/Zustand initially.

Separate:

1. persisted/backend state
2. edit draft state
3. ephemeral UI state

TanStack Query cache is not the target editor's draft state.

Project data can use long/infinite stale times with explicit invalidation because the main source is local SQLite.
