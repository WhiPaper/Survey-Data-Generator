# Persistence & Project Lifecycle Contract

## Ownership

The TypeScript sidecar owns the project database.

Do **not** use Tauri SQL as the main domain database interface.

Reason: Google responses, profiles, solver, synthetic rows and export all live in TypeScript; keeping DB ownership there avoids moving large datasets across IPC.

## Storage classes

### Encrypted SQLite

Stores:

- google_accounts
- projects
- form_snapshots
- source_revisions
- response_versions
- revision-response membership
- question_profiles
- relationship_profiles
- project targets / revisions
- synthesis_runs
- synthetic_responses
- optional AI generation metadata

Use relational columns for stable metadata/index/search and versioned JSON for polymorphic payloads.

Responses are stored row-by-row, not as one giant JSON array.

### SecureSecretStore

Stores:

- Google refresh tokens
- DB encryption key/root material
- optional LLM API key

### Memory only

Stores:

- access token
- short-lived OAuth/transient secrets
- in-process feature/solver intermediates

### Lightweight preferences

Tauri Store or similar may hold non-sensitive UI preferences such as last active account/window state if needed.

## Project repository

```ts
interface ProjectRepository {
  list(): Promise<ProjectSummary[]>
  get(id: ProjectId): Promise<SynthesisProject>
  create(input: CreateProjectInput): Promise<ProjectId>
  saveTargets(...): Promise<void>
  saveRun(...): Promise<void>
  delete(id: ProjectId): Promise<void>
}
```

React never accesses SQLite directly.

## Source revisions

A project points to a current immutable source revision.

```ts
interface SynthesisProject {
  id: ProjectId
  googleAccountId: GoogleAccountId
  googleFormId: FormId
  name: string

  currentSourceRevisionId: SourceRevisionId

  createdAt: string
  updatedAt: string
}
```

```ts
interface SourceRevision {
  id: SourceRevisionId
  projectId: ProjectId

  formSnapshotId: FormSnapshotId

  sourceResponseCount: number
  responseSetHash: string

  capturedAt: string
  previousRevisionId?: SourceRevisionId
}
```

Never overwrite a source revision.

## Response versions

A Google response may be added, changed or removed over time.

Store a content hash.

Comparison:

```text
same Google response ID + same hash → unchanged
same Google response ID + different hash → changed
new Google response ID → added
previously present, now absent → removed
```

Changed responses create new response versions rather than mutating historical revision data.

A revision references the exact response versions it contains.

## Form snapshots

Form snapshots are append-only.

`schemaHash` determines whether structure is unchanged before detailed diff.

Schema changes:

```text
none
compatible
breaking
```

Examples:

Compatible:

- new question
- title/description changes where targets remain valid

Breaking:

- targeted question removed
- question type changed
- targeted option removed/ambiguous
- branching structure changed
- grid structure changed

## Target migration

Use Google question ID as the first identity signal across snapshots.

Option mapping has confidence:

```text
exact
probable
ambiguous
```

Do not silently treat a renamed option as the same semantic target unless mapping is sufficiently certain.

Breaking target migration generates issues such as:

```text
question_removed
question_type_changed
option_removed
option_ambiguous
group_structure_changed
```

Do not silently delete invalid targets.

## Refreshing source data

Opening a project does **not** automatically call Google.

Default:

```text
open project
→ load encrypted local snapshot
```

This allows fast and offline access and preserves reproducibility.

Explicit command:

```text
⋯
새 응답 가져오기
```

Flow:

```text
fetch current Form + Responses
→ diff
→ migration analysis
→ if safe, create new SourceRevision transactionally
→ reprofile
→ reanalyze relationships
→ migrate targets
→ rerun feasibility
→ set currentSourceRevisionId
```

If only new responses were added and structure is unchanged, do not add unnecessary confirmation.

If breaking changes exist, show only the meaningful migration issues before applying.

## Target size after refresh

Existing target final N does not change automatically.

Example:

```text
source 50 → target 200
refresh → source 70
target remains 200
synthetic count becomes 130
```

If source grows beyond target final N, target becomes infeasible and the user must change it.

Do not automatically increase it.

## Runs

A run freezes:

```text
sourceRevisionId
targetRevision
targetSnapshot
seed
engineVersion
profilerVersion
appVersion
```

Past runs remain accessible after source refresh.

“결과 다시 만들기” normally means use the **current source revision + current targets**.

A separate low-frequency action may reproduce an old run using its original frozen source/target/seed.

## Semantic overrides

Maintain user semantic overrides across source refresh if the same compatible question remains.

If question kind becomes incompatible, report migration issue instead of silently applying/deleting the override.

## Historical export compatibility

Database migration keeps pre-v8 projects and pre-v9 Runs readable, but readability does not guarantee historical exportability.

Historical export is supported only when its export-critical inputs are present:

- A project must contain a valid persisted IANA timezone. A pre-v8 project with a valid timezone already persisted on its migrated project row may use that value as evidence. A missing value is unknown; the app must not infer it from the current OS timezone, response timestamp offsets, or other timestamps.
- A Run must contain a frozen semantic-override snapshot. The empty snapshot (`[]`) is valid. A `NULL` snapshot on a pre-v9 Run is missing historical information; the app must not substitute the project's current overrides.

When either input is missing, export returns the typed `LEGACY_COMPATIBILITY_REQUIRED` backend outcome and does not write a file. There is no promise that every historical Run remains exportable after migration when the old schema did not persist information required to reproduce export semantics.

## Form access loss

If the Google Form is deleted or sharing is revoked:

- existing local project still opens
- existing runs/export still work
- only refresh from Google fails

Do not allow relinking the same project to another Form in v1. Use a new project.

## Target revision

Autosaved target updates use optimistic concurrency:

```text
expectedRevision
→ atomic update if current revision matches
→ increment revision
```

Generation:

```text
flush valid draft
→ commit/get revision
→ feasibility
→ synthesis.start(projectId, targetRevision)
```

A running synthesis is frozen to that revision.

Later edits create a newer revision and do not mutate the active run.
