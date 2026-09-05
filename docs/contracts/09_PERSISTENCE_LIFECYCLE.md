# Persistence & Project Lifecycle Contract

Electron Main owns the local application database through Drizzle + better-sqlite3.

The repository is pre-release. Existing development DB schemas are not compatibility requirements.

## Clean v2 schema

Start from a new `0001` migration. Do not build a legacy importer or preserve historical v1 migration chains.

Initial logical tables may include:

```text
google_accounts
projects
form_snapshots
source_revisions
source_responses / response_versions
value_groups
target_drafts
runs
run_rows
preferences
```

Exact table decomposition may follow implementation needs, but avoid duplicated legacy/v2 persistence paths.

## Storage rules

- SQLite is plain local SQLite in v2; database encryption is not a product requirement.
- Google refresh tokens live in OS secure credential storage, not SQLite.
- Access tokens live in memory.
- Stable searchable metadata uses relational columns; polymorphic target/run snapshots may use JSON.
- Large response collections are stored/queryable as rows rather than one giant JSON array.
- Renderer never accesses SQLite directly.

## Projects

A Project is a lightweight local container for the Form connection, current source revision, editable targets/groups, and run history. Keep Google account/Form connection data separate enough that computation-domain types do not become integration records.

## Source revisions

Every import/refresh creates an immutable source revision that references the exact Form snapshot and response versions used.

Opening a project does not automatically refresh Google data.

Explicit refresh:

```text
fetch Form + all responses
→ normalize
→ create new immutable SourceRevision
→ revalidate current ValueGroups/targets
→ optionally set as current revision
```

Historical runs remain bound to their frozen source revision and scope.

## ValueGroups and targets

ValueGroups and target drafts are editable project state. A Run freezes snapshots of both rather than referring only to their latest mutable form.

## Runs

A Run persists at least:

```text
FrozenSourceScope
final response count
target snapshot
ValueGroup snapshot
seed
compute engine version
app version
approved EditPlan, if any
status/report
```

Completed Run results are immutable and export does not rerun synthesis.

## Original replacements

Never update imported source response values to represent an approved replacement.

Persist the source observation and the Run's replacement choice separately. The final Run table/result may materialize the transformed output for reliable export.

## Deletion

Project deletion removes local project-owned data after confirmation. Account logout/revoke behavior must not silently delete unrelated project data.

No secure-delete/cipher-specific subsystem is required for v2.

## Migration policy

Because no program has been distributed, compatibility with the current development DB is explicitly out of scope. Delete/recreate developer databases as needed while implementing the v2 schema.

Once a public release exists, schema migration policy must be reconsidered before changing persisted contracts.
