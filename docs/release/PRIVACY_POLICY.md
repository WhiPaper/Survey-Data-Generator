# Privacy Policy

**Publication Status:** Release-readiness draft  
**Product Name:** Survey Synth  
**Publisher:** To be confirmed by the release owner before public release

---

## 1. Overview

Survey Synth is a local-first Electron desktop application for importing Google Form responses and generating a target-constrained synthetic dataset. The application has no developer-operated data backend and has no LLM or AI feature.

## 2. Google Account and Form Data

Survey Synth uses Google OAuth and the Google Drive/Forms APIs to:

- identify the signed-in Google account;
- list accessible Google Forms;
- read the selected Form structure and responses.

OAuth and API requests are made directly from Electron Main to Google. Imported metadata and responses are stored locally in the application's plain SQLite database. Survey data is not sent to Survey Synth servers or to an LLM provider.

Refresh tokens are stored locally in the application data directory only after encryption through Electron `safeStorage`. The application refuses credential persistence when secure storage is unavailable, including the Linux `basic_text` backend. Access tokens remain in Electron Main memory and are never exposed to the renderer.

## 3. Local Processing

Form normalization, profiling, candidate generation, SciPy MILP selection, validation, quality diagnostics, and export run locally. The packaged Python compute process is launched for an individual job and exits when the job completes or is cancelled.

The v2 product does not promise database encryption or secure deletion. Users should protect the operating-system account and local application data directory using their normal device security controls.

## 4. Network Transfers

Application network traffic is limited to:

- Google OAuth and Google Drive/Forms endpoints required by the selected import workflow; and
- on Windows packaged builds, GitHub Release API/download endpoints used to check for and download application updates.

No survey response, imported Form content, project database, synthesis result, or export is sent to GitHub as part of update checking. The Windows updater uses a repository-scoped read-only credential embedded in Electron Main so users do not need to enter a GitHub credential. A distributed desktop binary can be inspected, so this value is treated as extractable and is not claimed to be confidential or to provide repository write authority.

There is no telemetry, advertising SDK, analytics service, cloud synchronization, or AI/LLM transfer path.

## 5. Exports

CSV and XLSX files are written locally to the path chosen by the user through the native save dialog. Default exports contain the final survey table without synthetic provenance columns.

## 6. Local Deletion

Deleting a project removes its project-owned records from the local database. Account revocation removes the stored Google refresh token and account-owned local project records according to the application's confirmation flow.

## 7. Contact and publication readiness

This file is a release-readiness draft, not evidence that a production privacy policy URL or dedicated privacy/support contact has been published. Before public release or Google OAuth production verification, the release owner must publish stable privacy/support URLs and real externally reachable contact details.

For non-sensitive project questions before that publication step, use the repository's GitHub Issues. Security reports should use a private GitHub security advisory rather than a public issue.
