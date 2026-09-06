# Support & Contact Guide

**Product Name:** Survey Synth  
**Repository:** https://github.com/WhiPaper/Survey-Data-Generator

## Getting help

- [GitHub Issues](https://github.com/WhiPaper/Survey-Data-Generator/issues) for bugs, workflow questions, and sanitized crash reports.

A dedicated production support contact has not yet been published. Before public release or Google OAuth production verification, the release owner must configure a real externally reachable support contact and stable public support/privacy URLs.

## Supported platforms

| Operating System | Architecture | Distribution |
|---|---:|---|
| Windows 10/11 | x64 | NSIS installer |
| Linux (Ubuntu 22.04+ baseline) | x64 | AppImage |

Node.js and Python are not required for installed users.

The Linux package target is configured, but representative Linux desktop acceptance is currently deferred. GitHub-hosted Linux packaged smoke is automated evidence only and does not establish representative device acceptance, secure `safeStorage` backend acceptance, or launcher/taskbar association.

## Frequently asked questions

### Where is data stored?

Projects, imported source revisions, targets, runs, and local results are stored in the application's local SQLite database. The database is plain SQLite in v2 and is not promised to be encrypted. Protect the operating-system account and application data directory.

### Does Survey Synth upload survey data?

No. Survey data is processed locally. Network access is limited to Google OAuth and Google Drive/Forms requests required by the selected import workflow plus, on packaged Windows builds, GitHub Release requests used to check for and download application updates. Update requests do not contain survey data. There is no developer backend, telemetry, cloud synchronization, or AI/LLM transfer path.

### How do updates work?

Packaged Windows builds check the private repository's latest non-prerelease GitHub Release. When a newer stable version exists, Survey Synth downloads the NSIS installer, verifies the SHA-256 digest reported by GitHub, and asks whether to restart. Choosing to restart launches the per-user installer silently and starts the updated application. Users do not enter a GitHub credential.

Linux automatic updating is not enabled in the current release plan; distribute a new AppImage manually when Linux distribution resumes.

### How do I delete data?

Use the project's delete action to remove project-owned records, or the account data deletion action to remove the account's stored refresh token and associated local project records after confirmation.

## Security reports

Do not open a public issue for a credential or data-exposure vulnerability. Use a private GitHub security advisory. A dedicated production security contact must be confirmed by the release owner before public release.
