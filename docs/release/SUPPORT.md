# Support & Contact Guide

**Product Name:** Survey Synth  
**Repository:** https://github.com/WhiPaper/Survey-Data-Generator

## Getting help

- [GitHub Issues](https://github.com/WhiPaper/Survey-Data-Generator/issues) for bugs and sanitized crash reports.
- [GitHub Discussions](https://github.com/WhiPaper/Survey-Data-Generator/discussions) for workflow questions.
- Support: `support@surveysynth.local`

## Supported platforms

| Operating System | Architecture | Distribution |
|---|---:|---|
| Windows 10/11 | x64 | NSIS installer |
| Linux (Ubuntu 22.04+ baseline) | x64 | AppImage |

Node.js and Python are not required for installed users.

## Frequently asked questions

### Where is data stored?

Projects, imported source revisions, targets, runs, and local results are stored in the application's local SQLite database. The database is plain SQLite in v2 and is not promised to be encrypted. Protect the operating-system account and application data directory.

### Does Survey Synth upload survey data?

No. Survey data is processed locally. Network access is limited to Google OAuth and Google Drive/Forms requests required by the selected import workflow. There is no developer backend, telemetry, cloud synchronization, or AI/LLM transfer path.

### How do updates work?

The current v2 package does not install updates automatically. Obtain release artifacts from the project's GitHub Releases page and verify the published release information before installation.

### How do I delete data?

Use the project's delete action to remove project-owned records, or the account data deletion action to remove the account's stored refresh token and associated local project records after confirmation.

## Security reports

Do not open a public issue for a credential or data-exposure vulnerability. Use a private GitHub security advisory or contact `security@surveysynth.local`.
