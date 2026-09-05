# Google Authentication & Form Import Contract

Google is the only identity provider. Do not create a generic provider abstraction.

## Account identity

Use Google OpenID Connect `sub` as the stable identity. Email, display name, and picture are display metadata only.

## OAuth

Electron Main owns installed-app OAuth:

- system browser
- loopback callback on `127.0.0.1` random port
- PKCE S256
- state validation
- one-shot callback listener

Refresh tokens live in OS-appropriate secure credential storage. Access tokens live in Electron Main memory. Renderer never receives either.

On API 401, force one refresh and retry once. `invalid_grant` becomes `REAUTH_REQUIRED` while local projects remain available.

## Form listing

Use Drive metadata APIs to list accessible Google Forms. Do not fetch response counts for every list item.

## Import

After Form selection, fetch Form structure and all paginated responses, then normalize them into a `FormSnapshot` and response observations.

```text
Google Form + Responses
→ normalization
→ evidence-aware Form routing
→ immutable SourceRevision
→ local SQLite
```

Do not run a custom relationship analyzer during import.

## Refresh

Project opening uses local data. Google refresh is explicit.

A refresh creates a new immutable `SourceRevision`; it does not mutate previous revisions. The current target draft may need revalidation against the new Form/source, but there is no pre-release database compatibility requirement.

## Rules

- Renderer never calls Google APIs directly.
- Unknown Google question types become unsupported normalized questions rather than crashing import.
- File-upload bytes are not downloaded.
- A source revision with zero usable responses cannot be synthesized without an explicit future generation policy; v2 should block it.
- Google API permission failures must be concise and actionable.
