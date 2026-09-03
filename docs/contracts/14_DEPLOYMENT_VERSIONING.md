# Deployment, Packaging, Updates & Versioning

## One product bundle

User receives one application containing:

```text
Tauri app
React frontend
Rust host
TypeScript sidecar
DB/native runtime
solver runtime
```

Sidecar is not separately downloaded/updated.

## No Node requirement

End users do not install:

- Node.js
- npm/pnpm
- Python
- external solver

Production sidecar is self-contained from the user's perspective.

`@yao-pkg/pkg` is an implementation candidate, not an architecture contract.

If native encrypted SQLite packaging is unreliable in that mode, bundle an appropriate Node runtime plus packaged JS/native resources instead.

Whichever implementation is chosen must pass installed-artifact tests on every supported OS/architecture.

## Initial targets

Recommended initial set:

| OS | Arch | Package |
|---|---|---|
| Windows | x86_64 | NSIS `.exe` |
| macOS | arm64 | DMG |
| macOS | x86_64 | DMG |
| Linux | x86_64 | AppImage |

Do not add Windows ARM/Linux ARM until justified by demand.

macOS may use architecture-specific builds instead of Universal initially because sidecar/native DB packaging is simpler to validate.

## Signing

Production requirements:

### macOS

- Developer ID signing
- notarization
- validate final bundle and sidecar launch

### Windows

- sign executable/installer appropriately
- verify sidecar is also covered/valid as required by packaging/signing strategy

### Updater

Tauri updater signing is a separate trust mechanism from OS code signing.

Updater private key is release-critical:

- never in git
- CI secret
- separately backed up securely
- minimal access

## Linux baseline

Build AppImage on a deliberate older compatible Linux baseline rather than a developer's newest distribution.

Initial direction: Ubuntu 22.04 x86_64 or similarly chosen baseline, subject to actual native dependency testing.

## Native runner rule

Prefer native release runners per target OS/arch, especially because the product includes native SQLite/sidecar dependencies.

## Version taxonomy

```ts
interface BuildVersions {
  appVersion: string

  protocolVersion: number

  databaseSchemaVersion: number
  domainSchemaVersion: number

  engineVersion: number
  profilerVersion: number

  promptTemplateVersion?: number
}
```

### appVersion

User-visible SemVer, e.g. `1.4.2`.

### protocolVersion

Rust/sidecar NDJSON wire contract.

Because host + sidecar ship together, require exact match.

### databaseSchemaVersion

Relational SQLite migration version.

### domainSchemaVersion

Version for JSON payload semantics/shape inside the DB.

### engineVersion

Synthesis-result semantics. Increment when solver/mutation/repair behavior changes materially.

### profilerVersion

Profiling/semantic/relationship algorithm version.

### sidecar version

No independent semantic version. It uses the same app version because it is always shipped with the app.

## Startup compatibility

Host/sidecar:

```text
appVersion exact match
protocolVersion exact match
```

Mismatch is package corruption/incomplete update, not a compatibility feature.

Fail fast with a short recoverable startup error.

## Database migration

Old user DB must be migrated sequentially:

```text
12 → 13 → 14 → 15
```

Do not maintain every direct old→new path.

Use transactions.

For significant migrations, make an encrypted backup first.

If migration fails:

- preserve original DB
- do not create an empty replacement
- stop opening project data
- allow retry/recovery

Migration compatibility is not the same as historical export compatibility. Pre-v8 projects with no persisted timezone and pre-v9 Runs with no frozen semantic-override snapshot remain readable, but their export is outside the supported historical-export boundary. Export must report the typed `LEGACY_COMPATIBILITY_REQUIRED` outcome rather than infer or replace either value.

Downgrade of a newer database is not supported.

If app expected schema is older than the DB, do not modify the DB.

## Engine/profiler history

Do not re-synthesize old runs after an engine update.

Do not automatically rewrite old source profiles simply because the profiler version changed.

New runs/revisions use current algorithms; old records retain their recorded versions.

## Updates

Use Tauri updater.

Update artifact includes host/frontend/sidecar/runtime together.

Do not separately update the sidecar.

Recommended UX:

- background check no more often than roughly daily
- no UI if there is no update
- concise non-blocking “새 버전이 있습니다. [업데이트]”
- no dedicated update page initially

Do not install while:

- synthesis is active
- source update is active
- export is active
- DB migration is active

Update sequence:

```text
flush target autosave
→ ensure no active job
→ request sidecar shutdown
→ DB checkpoint/close
→ install update
→ relaunch
→ new app performs DB/domain migration
```

Update failure before new app launch does not modify the DB schema.

## Release pipeline

Conceptual:

```text
git tag
→ tests
→ target build matrix
→ sidecar smoke
→ app integration
→ OS signing
→ macOS notarization
→ updater signing
→ installed-artifact smoke
→ publish installers
→ publish updater metadata
```

GitHub Actions is a reasonable initial pipeline.

## Packaged smoke tests

Actual installed/bundled artifact must verify:

```text
sidecar exists
sidecar launches
RPC handshake
encrypted DB create/open
migration
HiGHS/optimization worker
Google auth URL generation
CSV export
XLSX export
```

A successful TypeScript unit test suite is not evidence that packaging works.

## Encrypted SQLite gate

On each target:

```text
create encrypted DB
insert known marker
close
raw-file scan for plaintext marker
reopen
verify data
migration
secure delete path
```

If native packaging fails, do not publish that target.

## Release channels

v1 exposes stable only.

Internal prerelease builds may exist, but no Stable/Beta/Nightly preference UI initially.
