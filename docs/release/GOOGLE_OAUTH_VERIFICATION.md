# Google OAuth Verification Readiness Guide

**Product Name:** Survey Synth  
**Application Type:** Desktop Application (Local Client)  
**Applicable Contract:** `docs/contracts/12_SECURITY_PRIVACY.md`

## 1. OAuth scopes and justifications

| Scope | Purpose |
|---|---|
| `openid` | Obtain the stable Google subject identifier for local account identity. |
| `email` | Display the signed-in email address and distinguish local accounts. |
| `profile` | Read optional display metadata such as the account display name. |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | List accessible Google Forms without reading arbitrary Drive file bytes. |
| `https://www.googleapis.com/auth/forms.body.readonly` | Read the selected Form structure, questions, choices, and routing. |
| `https://www.googleapis.com/auth/forms.responses.readonly` | Read the selected Form's responses for local import and synthesis. |

Survey Synth does not create or modify Google Forms or responses.

## 2. User-data handling

1. Responses are processed locally by Electron Main and the packaged Python compute process.
2. Local application data uses plain SQLite in v2; no encrypted-database guarantee is made.
3. Refresh tokens are stored as Electron `safeStorage`-encrypted values in the local application data directory. Credential persistence is refused when secure storage is unavailable, including the Linux `basic_text` backend; access tokens remain in Electron Main memory.
4. No survey data is sent to Survey Synth servers, telemetry services, advertising networks, or AI/LLM providers.

## 3. Demonstration flow

1. Launch the packaged Electron application and start Google login.
2. Show the system browser consent page and requested scopes.
3. Return to the app, list accessible Forms, and import one selected Form.
4. Show the immutable source revision, response count, question structure, and target configuration.
5. Run synthesis locally, including target validation and the packaged Python job.
6. Export CSV/XLSX locally and show the final table contains no provenance columns.

## 4. Cloud Console checklist

- [ ] App name and real externally reachable support contact configured.
- [ ] Public privacy policy URL published and reviewed against the current implementation.
- [ ] Public terms/support URL published and reviewed against the current implementation.
- [ ] Privacy/support pages contain production contact details rather than placeholder addresses.
- [ ] OAuth redirect/client configuration reviewed for the packaged desktop application.
- [ ] Demonstration video shows only the scopes and local workflow implemented by the current release.
- [ ] Actual Google sign-in, Form listing, and Form import are manually accepted with the production OAuth project before release.
