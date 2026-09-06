# Privacy Policy

**Effective Date:** September 6, 2026  
**Product Name:** Survey Synth  
**Publisher:** Survey Synth Team

---

## 1. Overview

Survey Synth is a local-first Electron desktop application for importing Google Form responses and generating a target-constrained synthetic dataset. The application has no developer-operated data backend and has no LLM or AI feature.

## 2. Google Account and Form Data

Survey Synth uses Google OAuth and the Google Drive/Forms APIs to:

- identify the signed-in Google account;
- list accessible Google Forms;
- read the selected Form structure and responses.

OAuth and API requests are made directly from Electron Main to Google. Imported metadata and responses are stored locally in the application's plain SQLite database. Survey data is not sent to Survey Synth servers or to an LLM provider.

Refresh tokens are stored in the operating system's secure credential store. Access tokens remain in Electron Main memory and are never exposed to the renderer.

## 3. Local Processing

Form normalization, profiling, candidate generation, SciPy MILP selection, validation, quality diagnostics, and export run locally. The packaged Python compute process is launched for an individual job and exits when the job completes or is cancelled.

The v2 product does not promise database encryption or secure deletion. Users should protect the operating-system account and local application data directory using their normal device security controls.

## 4. Network Transfers

Application network traffic is limited to Google OAuth and Google Drive/Forms endpoints required by the selected workflow. There is no telemetry, advertising SDK, analytics service, cloud synchronization, or AI/LLM transfer path.

## 5. Exports

CSV and XLSX files are written locally to the path chosen by the user through the native save dialog. Default exports contain the final survey table without synthetic provenance columns.

## 6. Local Deletion

Deleting a project removes its project-owned records from the local database. Account revocation removes the stored Google refresh token and account-owned local project records according to the application's confirmation flow.

## 7. Contact

- Privacy: `privacy@surveysynth.local`
- Support: `support@surveysynth.local`
- Repository: https://github.com/WhiPaper/Survey-Data-Generator
