# Privacy Policy

**Effective Date:** September 3, 2026  
**Product Name:** Survey Synth  
**Publisher:** Survey Synth Team  

---

## 1. Overview & Architecture Principle

Survey Synth is built with a **local-first privacy architecture**. The application is designed to help researchers, analysts, and developers synthesize representative survey datasets locally on their own devices without transmitting sensitive survey responses or personal data to developer-hosted servers.

This Privacy Policy explains how Google account data, Google Form metadata, survey responses, and optional AI features are handled by Survey Synth.

---

## 2. Google Account Information Use

When you sign in with Google, Survey Synth requests authentication through Google OAuth 2.0.
- **Data Accessed:** Your stable Google Subject Identifier (`sub`) and display email address.
- **Purpose:** To authenticate access to your Google Forms, identify distinct local project workspaces, and allow switching between multiple authorized Google accounts on the same device.
- **Storage:** Google account metadata is stored strictly on your local device. The Google Subject ID acts as the internal account key, while the email address is displayed exclusively for your visual reference.
- **No Developer Server:** Survey Synth operates without any developer-operated authentication servers; OAuth authorization flows directly between your desktop client and Google's OAuth endpoints (`https://accounts.google.com/`).

---

## 3. Google Form Metadata & Question Structure Use

Survey Synth connects to the Google Forms API (`https://forms.googleapis.com/`) and Google Drive API (`https://www.googleapis.com/drive/v3/`) using the user's authorized credentials:
- **Data Accessed:** Form identifiers, titles, question schemas (types, question titles, option values, scale ranges, grid configurations), and routing branch logic.
- **Purpose:** To inspect the structure of the survey form and configure local statistical profiling, constraint targets, and reachability models for synthesis.
- **Processing:** Form metadata is retrieved directly to your local application sidecar and stored within your encrypted local project database.

---

## 4. Local-First Survey Response Storage and Analysis

- **Local Analysis:** Survey responses are imported directly from Google Forms into your local machine. All statistical profiling, marginal distributions, cross-tabulation relationships, optimization, and synthesis execution take place **entirely on your local device** using local worker threads and local mathematical solvers (HiGHS).
- **No Cloud Uploads:** Raw survey responses and synthetic rows are never uploaded, backed up, or transmitted to Survey Synth servers or any third-party cloud infrastructure.
- **Encrypted at Rest:** All imported survey data, source revisions, historical runs, and synthesized outputs are stored locally in an AES-256 encrypted SQLite database (`sqlcipher`).

---

## 5. Secure Credential & Token Storage

Survey Synth protects sensitive credentials using native operating system security:
- **OS Keyring Integration:** Google OAuth refresh tokens, local database encryption keys, and optional AI API keys are stored in the operating system's native secure credential store (Windows Credential Manager or Linux Secret Service / Keyring).
- **No Plaintext Tokens:** Refresh tokens and cryptographic keys are never written to unencrypted configuration files, disk logs, or application caches, and are never exposed to the frontend WebView/UI.
- **Safe Logging:** Application logs (`SafeLogger`) enforce a strict field allowlist to guarantee that raw survey answers, respondent PII, OAuth tokens, and secret keys are never written to logs or stderr.

---

## 6. No Uploaded File-Byte Processing

Surveys created in Google Forms may include "File Upload" question types where respondents attach files stored in Google Drive:
- **Metadata Only:** Survey Synth inspects only the question structure (e.g., verifying that a file-upload question exists).
- **Zero File Byte Download:** Survey Synth **never downloads, inspects, or processes the file bytes or contents** of files uploaded by survey respondents to Google Drive. The application's Google Drive permissions are strictly limited to `drive.metadata.readonly` to discover form identifiers.

---

## 7. Telemetry & Crash Reporting

- **Zero Survey Data Telemetry:** Survey Synth does not collect or transmit automatic analytics, usage metrics, survey contents, or diagnostic payloads containing survey data.
- **No Tracking:** The application contains no tracking pixels, advertising identifiers, or behavioral analytics SDKs.

---

## 8. Developer-Server Transfer Behavior

- **Zero Developer-Hosted Infrastructure:** Survey Synth does not maintain a backend web server, database, or API service in the application data path.
- **Direct Communication:** Network calls originating from the application are restricted exclusively to:
  1. Google APIs (`https://accounts.google.com/`, `https://forms.googleapis.com/`, `https://www.googleapis.com/`) for authentication and form importing.
  2. GitHub Releases (`https://github.com/` / `api.github.com`) strictly for checking and downloading signed desktop software updates.
  3. Optional LLM API endpoints (only if explicitly enabled by the user, as detailed below).

---

## 9. Optional Third-Party AI Generation Behavior

Survey Synth provides an **optional** AI text generation feature to fill synthetic free-text and short-answer questions:
- **Disabled by Default:** The AI feature is completely turned off by default (`AI_MODE=OFF`). When turned off, zero network requests to any AI or LLM provider are made.
- **User-Provided API Key:** Users must explicitly provide their own API key (e.g., Google Gemini or OpenAI API key). The key is saved directly into the OS Keyring and is never transmitted to Survey Synth developers.
- **Explicit Disclosure & Consent:** Before any AI generation can proceed, the user is presented with an explicit confirmation dialog detailing what data will be sent to the selected AI provider.
- **Minimal Context & PII Scrubbing:** Only anonymized question text and a minimal set of random non-PII examples are sent to generate representative answers. Raw respondent identifiers or full response rows are never included in prompts.

---

## 10. User-Directed Local Export & Deletion

- **Local Exports Only:** Exported CSV and XLSX datasets are generated locally and saved to the specific local file directory chosen by the user through the operating system's native save dialog. Default exports contain no metadata revealing synthetic provenance.
- **Secure Deletion:** When a project is deleted in Survey Synth, SQLite's secure overwrite (`PRAGMA secure_delete = ON`) is executed, permanently purging project tables, historical runs, and orphaned responses.
- **Device Account Data Deletion:** Using the "기기에서 데이터 삭제" (Delete this device's account data) action immediately purges the account's OAuth refresh tokens from the OS Keyring, removes account metadata, and cascadingly deletes all local projects associated with that Google account.

---

## 11. Contact & Inquiries

For questions or concerns regarding this Privacy Policy or data privacy in Survey Synth, please contact:
- **Email:** `privacy@surveysynth.local` (or refer to our GitHub repository: `https://github.com/WhiPaper/Survey-Data-Generator`)
- **Support Documentation:** [docs/release/SUPPORT.md](SUPPORT.md)
