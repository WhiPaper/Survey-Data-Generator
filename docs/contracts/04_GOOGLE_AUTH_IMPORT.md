# Google Authentication & Form Import Contract

## Account model

Google is the only identity provider. Do not create a generic provider abstraction.

```ts
interface GoogleAccount {
  id: GoogleAccountId
  subject: string       // Google OAuth `sub`, stable identity
  email: string
  displayName?: string
  createdAt: string
  lastUsedAt: string
}
```

The identity key is Google `sub`, not email.

Projects reference `google_account_id`.

Local table name: `google_accounts`.

## OAuth

Desktop installed-app OAuth:

- system browser
- loopback callback `127.0.0.1:<random-port>`
- random ephemeral port
- PKCE S256
- state validation
- callback processed once, then listener stops

Installed-app client secret is not treated as a meaningful secret/security boundary.

The user already has a Google OAuth installed-app client.

Likely scope set:

```ts
[
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
]
```

Scope policy must be rechecked against current Google Cloud verification requirements before public release.

`drive.metadata.readonly` is intentionally accepted because the product requirement is an in-app browser of accessible Forms. A narrower Picker/`drive.file` design would conflict with that requirement.

## Tokens

```text
refresh token → SecureSecretStore
access token  → TS sidecar memory only
account metadata → encrypted SQLite
```

React never receives tokens.

```ts
interface GoogleTokenStore {
  getRefreshToken(subject: string): Promise<string | null>
  setRefreshToken(subject: string, token: string): Promise<void>
  deleteRefreshToken(subject: string): Promise<void>
}
```

```ts
interface GoogleAccessTokenProvider {
  getAccessToken(accountId: GoogleAccountId): Promise<string>
}
```

Use a refresh safety margin.

Refresh is single-flight per Google account.

API 401:

1. force refresh
2. retry the API call exactly once

Refresh failure such as `invalid_grant`:

- delete invalid local refresh token
- report `REAUTH_REQUIRED`
- keep projects intact

## Account actions

```ts
interface GoogleAuthService {
  getSession(): Promise<SessionView | null>
  login(): Promise<SessionView>
  addAccount(): Promise<SessionView>
  switchAccount(id: GoogleAccountId): Promise<SessionView>
  logout(): Promise<void>
  revokeAccess(id: GoogleAccountId): Promise<void>
  getAccounts(): Promise<GoogleAccountView[]>
}
```

Semantics:

- switch account — retain tokens and projects
- logout — remove local active account token/session, preserve project data and Google grant
- revoke access — explicitly revoke Google grant/token; consequential action
- same `sub` on OAuth login activates existing account rather than creating a duplicate

## Startup

```text
last_account_id
→ refresh token
→ access token refresh
→ projects

missing/invalid token
→ login
```

Do not add a long auth splash.

## Form list

Use Drive to list:

- MIME: `application/vnd.google-apps.form`
- `trashed=false`
- narrow fields
- Shared Drive support direction via `supportsAllDrives` / `includeItemsFromAllDrives`
- search and recent ordering

Do not call Forms Responses merely to show a response count beside every Form.

## Form import

After selection, fetch in parallel:

```text
forms.get(formId)
forms.responses.list(formId)
```

Paginate through all responses.

Then:

```text
Google Raw Form
  → GoogleFormNormalizer
  → FormSnapshot

Google Raw Responses
  → GoogleResponseNormalizer
  → NormalizedResponse[]
```

Then:

```text
PathResolver
→ Profiler
→ RelationshipAnalyzer
→ encrypted SQLite transaction
→ Target Editor
```

Rules:

- React never calls Google APIs directly.
- 0-response Form cannot create an augmentation project.
- permission errors are short and actionable.
- unknown future Google question type becomes `UnsupportedQuestion`, never an app crash.
- file-upload content bytes are not downloaded for this product.
