# Support & Contact Guide

**Product Name:** Survey Synth  
**Repository:** `https://github.com/WhiPaper/Survey-Data-Generator`  

---

## 1. Getting Help & Support

Survey Synth is an open-source, local-first desktop application for representative survey data synthesis and target optimization.

### Official Channels
- **Issue Tracker:** [GitHub Issues](https://github.com/WhiPaper/Survey-Data-Generator/issues) for bug reports, crash logs (sanitized), and feature requests.
- **Discussions & Questions:** [GitHub Discussions](https://github.com/WhiPaper/Survey-Data-Generator/discussions) for community Q&A and workflow guidance.
- **Email Contact:** `support@surveysynth.local`

---

## 2. Supported Platforms & System Requirements

| Operating System | Supported Architecture | Minimum Version | Notes |
|:---|:---:|:---:|:---|
| **Windows** | x64 | Windows 10 (Build 19041+) or Windows 11 | WebView2 runtime included |
| **Linux** | x64 | Ubuntu 22.04 LTS+, Fedora 38+ | AppImage distribution (glibc 2.35+) |

**Hardware Requirements:**
- RAM: 4 GB minimum (8 GB+ recommended for synthesis runs over 10,000 rows).
- Disk Space: 250 MB free for application installation; additional disk space depending on survey dataset size.
- Node.js: **Not required** (Survey Synth bundles its own self-contained, isolated JavaScript runtime).

---

## 3. Frequently Asked Questions (FAQ)

### Where is my survey data stored?
All imported survey forms, respondent answers, target configurations, and synthesized datasets are stored entirely locally on your computer in an encrypted SQLite database:
- **Windows:** `%APPDATA%\com.surveysynth.desktop\`
- **Linux:** `~/.config/com.surveysynth.desktop/`

### How is my data encrypted?
Survey Synth uses SQLCipher (AES-256-CBC) encryption for local database files. Encryption keys are generated cryptographically and stored in your operating system's native secure credential storage (Windows Credential Manager, Linux Secret Service).

### Does Survey Synth upload my data to the cloud?
No. Survey Synth has no developer servers or cloud synchronization. Data travels strictly between your device and Google's official OAuth/Forms endpoints to retrieve your forms, and directly between your device and your chosen local export folder (CSV/XLSX).

### How do updates work?
Survey Synth automatically checks GitHub Releases once every 24 hours for signed software updates. Updates will never install while an active import, synthesis, or export task is running. Before an update applies, Survey Synth flushes target drafts, checkpoints the encrypted database, and verifies the update's cryptographic signature.

### How do I delete my data from this computer?
- **To delete a single project:** Open the project in Survey Synth and click **프로젝트 삭제** (Delete Project) -> confirm permanent deletion.
- **To delete an account and all its data:** Open the **계정 메뉴** (Account Menu) -> next to the account, click **기기 데이터 삭제** (Delete this device's account data) -> confirm permanent deletion. This completely removes the OAuth tokens from the OS Keyring and purges all associated local project databases.

---

## 4. Security & Vulnerability Reporting

We take security and privacy seriously. If you discover a potential security vulnerability (such as credential exposure, unencrypted data leakage, or cryptographic flaws):
- **Do not open a public GitHub issue.**
- Please report vulnerabilities directly to `security@surveysynth.local` or submit a private security advisory on GitHub.
- We will acknowledge receipt within 48 hours and work with you to remediate the issue promptly.
