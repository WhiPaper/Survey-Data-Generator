# Security & Privacy Contract

## Security boundary

Default data flow:

```text
Google
  ↓ HTTPS
TS Sidecar
  ├─ encrypted local SQLite
  ├─ local profiling/synthesis
  └─ local export

React sees only view models.
```

There is no required developer-owned server in the survey-data path.

Optional AI is the only designed path where selected survey-derived information may leave the device beyond Google services, and only after explicit user activation.

## Local-first rule

Google Form responses are stored and processed locally by default.

Do not automatically:

- upload project DB
- create cloud backup
- sync project data
- send telemetry containing survey data

## Encrypted SQLite

Project database is encrypted at rest by default.

Use a `ProjectDatabase` abstraction and keep the concrete cipher/native library replaceable.

Do not architect the domain around a specific package.

Store the DB encryption key/root material only through `SecureSecretStore`.

Never store the key in:

- SQLite
- Tauri Store
- .env in production
- React state
- logs
- project JSON

## SecureSecretStore

```ts
interface SecureSecretStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
}
```

Prefer OS-native secure credential storage.

Stronghold may be used as part of the implementation, but it is not itself the architectural contract and its unlock secret must also be managed securely.

Secret namespaces may resemble:

```text
google:<sub>:refresh_token
database:master_key
llm:<provider>:api_key
```

## WebView trust

Treat the React WebView as outside the high-trust secret boundary.

React must not receive:

- Google refresh/access tokens
- database key
- LLM API key

Do not grant WebView:

- raw shell spawn
- raw filesystem
- direct SQLite
- unrestricted host capabilities

React does not call Google or LLM APIs directly.

## Tauri capabilities

Keep permissions minimal and host mediated.

The sidecar may request narrow host capabilities such as:

```text
open_external
secret.get/set/delete
path.app_data
dialog.save
```

Business semantics remain in TypeScript.

## File uploads

Do not fetch/store actual uploaded Drive file bytes for this product.

No need to request broader Drive-content access merely for file-upload questions.

Use available metadata only where needed.

## Logging

No raw survey values in logs.

Good:

```text
responses=53
questions=18
durationMs=482
errorCode=RATE_LIMITED
```

Bad:

```text
email=...
comment=...
refresh_token=...
prompt=...
```

Use structured `SafeLogger` with an allowlisted field model rather than arbitrary `console.log(object)` in production paths.

Identifiers may be locally salted/hashed for diagnostics.

Logs:

- local only by default
- no automatic external upload
- rotate/cap aggressively
- do not contain secrets or response payloads

Future “save diagnostics” must create a sanitized diagnostic package only.

## Temporary files

Avoid disk temp files for:

- OAuth codes/tokens
- LLM prompts
- feature/solver intermediates

Export temp files, if required:

- live under app cache
- have random names
- are deleted on success/failure/cancel
- orphan cleanup runs at startup

## Deletion

### Project delete

Consequential and confirmed.

Deletes project-owned:

- source revisions
- response versions no longer referenced
- profiles
- relationship profiles
- targets
- runs
- synthetic rows
- AI metadata

Use secure deletion settings for SQLite where supported, e.g. `PRAGMA secure_delete=ON`, with periodic/maintenance vacuum rather than expensive synchronous vacuum after every small deletion.

### Logout

Removes local active account session/token but preserves project data.

### Revoke Google access

Removes/revokes Google authorization while preserving local projects.

### Delete this device's account data

Removes:

- account refresh token
- account metadata
- all projects associated with that local Google account

Does not affect other local accounts.

## Retention

Project data remains until the user deletes it.

Automatic retention applies only to:

- logs
- cache
- temporary exports
- OAuth transient state

## AI privacy

Default:

```text
whole dataset        not sent
personal identifiers not sent
files                not sent
structured context   minimum required only
source free text     redacted + small sample only when needed
```

First AI activation discloses external transfer in a concise Dialog.

Privacy Policy must accurately reflect the implementation.

## Public release web requirements

Prepare:

- product homepage
- privacy policy
- support/contact

Privacy policy must disclose:

- Google account info use
- Form metadata use
- Form response local storage/analysis
- secure token storage
- no uploaded file-byte processing
- telemetry default
- developer-server transfer behavior
- optional AI third-party transfer behavior
- user-directed local export

Before release, recheck current Google restricted/sensitive scope verification requirements.

## Threat model

Defend against:

- copied DB files
- log leakage
- WebView compromise
- unnecessary network transmission
- overly broad IPC/Tauri permissions
- temp-file residue
- application mistakes exposing user data

Do not claim protection from a fully compromised/root/admin-controlled OS.

JavaScript memory cannot promise perfect secret zeroization; minimize secret lifetime and copies instead.
