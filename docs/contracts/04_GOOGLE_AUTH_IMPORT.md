# Google Authentication & Form Import Contract

Google is the only identity provider. Do not create a generic provider abstraction.

## Account identity

Use Google OpenID Connect `sub` as the stable identity. Email, display name, and picture are display metadata only. Because v2 is Google-only, `GoogleAccountId` may use the `sub` value directly rather than persisting a second duplicate provider identifier.

## OAuth

Electron Main owns installed-app OAuth:

- system browser
- loopback callback on `127.0.0.1` random port
- PKCE S256
- state validation
- one-shot callback listener

Use Google's maintained `google-auth-library` for PKCE generation, authorization-code token exchange, access-token refresh, ID-token verification, and revocation. Survey Synth should only own the desktop-specific browser/loopback choreography and local session persistence around that library.

Refresh tokens live in OS-appropriate secure credential storage. Access tokens live in Electron Main memory. Renderer never receives either.

On API 401, force one refresh and retry once. `invalid_grant` becomes `REAUTH_REQUIRED` while local projects remain available.

## Form listing

Use the maintained `@googleapis/drive` client to list accessible Google Forms by MIME type. Do not fetch response counts for every list item.

Keep provider page tokens opaque. The renderer may search or request another page, but it must not interpret Google pagination tokens.

## Import

Use the maintained `@googleapis/forms` client for Form structure and response pagination. After Form selection, fetch Form structure and all paginated responses, then normalize them into a `FormSnapshot` and response observations.

```text
Google Form + Responses
→ product-specific normalization
→ evidence-aware Form routing
→ create local Project + immutable SourceRevision atomically
→ local SQLite
```

The Google API transport, pagination requests, token refresh, and provider error transport should remain library-backed. Custom code is justified only for Survey Synth domain normalization, hard Form invariants, and persistence semantics.

Import persists immediately; do not introduce a separate in-memory import-session subsystem before project creation.

Do not run a custom relationship analyzer during import.

## Normalization

- Preserve Google question IDs and Form structure as evidence.
- Unknown Google question types become `unsupported` normalized questions rather than crashing the whole import.
- Only API-confirmed branching becomes routing evidence.
- Preserve the distinction between answered, skipped, not reached, and indeterminate responses.
- File-upload metadata may be normalized; file bytes are never downloaded.
- Form schema hashes exclude capture-time noise so equivalent structures compare consistently.

## Refresh

Project opening uses local data. Google refresh is explicit.

A refresh creates a new immutable `SourceRevision`; it does not mutate previous revisions. The current target draft may need revalidation against the new Form/source, but there is no pre-release database compatibility requirement.

## Rules

- Renderer never calls Google APIs directly.
- A source revision with zero usable responses cannot be synthesized without an explicit future generation policy; v2 should block it.
- Google API permission failures must be concise and actionable.
- Do not recreate a sidecar-style Google API client, pagination framework, or import-session store around the official libraries unless a real product failure requires it.
