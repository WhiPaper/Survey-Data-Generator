# Survey Synth

M0 establishes the desktop process boundary:

```text
React → Tauri invoke → Rust host → NDJSON → TypeScript sidecar
```

## Development

Requirements: Node.js, pnpm, and Rust.

```text
pnpm install
pnpm check
pnpm tauri dev
```

The sidecar uses local Node tooling in M0. Its production replacement is staged through
`src-tauri/binaries/` without changing the NDJSON protocol.

### Google OAuth development configuration

By default, development reads `google_oauth.local.json` from the repository root. To
override it for the current PowerShell session:

```powershell
$env:SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG = "$PWD\google_oauth.local.json"
pnpm tauri dev
```

Alternatively, set `SURVEY_SYNTH_GOOGLE_CLIENT_ID` and, when required,
`SURVEY_SYNTH_GOOGLE_CLIENT_SECRET` in the environment before starting Tauri. Do not
commit credentials or place them in frontend-exposed Vite variables.

## Google authentication

The sidecar reads an installed-app OAuth client from `google_oauth.local.json` by default.
That file is ignored by Git. Production/dev environments may instead set
`SURVEY_SYNTH_GOOGLE_CLIENT_ID`, optional `SURVEY_SYNTH_GOOGLE_CLIENT_SECRET`, or
`SURVEY_SYNTH_GOOGLE_OAUTH_CONFIG`.

M1 stores account metadata in a sidecar-owned local state file until encrypted project
SQLite arrives. Refresh tokens use the host OS credential store; access tokens remain
sidecar memory only and never cross into React.
