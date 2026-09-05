# Security & Privacy Contract

Survey Synth is local-first, but v2 does not make an encrypted-database product guarantee.

## Data flow

```text
Google APIs
   ↓ HTTPS
Electron Main
   ├─ local SQLite
   ├─ local export
   └─ packaged local Python compute job
```

There is no LLM/AI data transfer path in v2.

## Credentials

- Google refresh token: OS-appropriate secure credential storage
- Google access token: Electron Main memory
- renderer: never receives OAuth tokens

Do not store refresh tokens in SQLite or logs.

## Local project data

Project/Form/response/run data is stored locally in plain SQLite in v2.

Do not claim encrypted-at-rest protection in product copy or privacy policy unless implementation later changes.

Do not automatically:

- upload project databases
- sync survey data to developer servers
- create cloud backups
- send telemetry containing survey responses

## Renderer boundary

Use a narrow preload/contextBridge API. Renderer must not receive unrestricted filesystem/process/SQLite capabilities.

## File uploads

Do not fetch or duplicate uploaded Drive file bytes. Use only metadata needed for normalized/export behavior.

## Logging

Production logging should use counts, timing, status codes, and sanitized identifiers rather than raw survey answers or secrets.

Never log:

- refresh/access tokens
- raw free-text responses
- whole response payloads

## Temporary compute files

Parquet/JSON job files may exist in the app's working/cache area for a compute job.

They must be cleaned on successful completion, failure, cancellation, and startup orphan cleanup where practical. Do not create a custom secure-erasure subsystem.

## Deletion

Project deletion is explicit and removes local project-owned records/results. Logout/revoke removes credential/session state according to the Google auth contract without silently deleting unrelated projects.

## Public release

Before public release, ensure actual product/privacy copy matches the implementation and recheck current Google OAuth scope verification requirements.

Do not document security properties the code does not actually provide.
