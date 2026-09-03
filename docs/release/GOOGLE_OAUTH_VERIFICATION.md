# Google OAuth Verification Readiness Guide

**Product Name:** Survey Synth  
**Application Type:** Desktop Application (Local Client)  
**OAuth Client ID Type:** Desktop App / Native  
**Applicable Contract:** `docs/contracts/12_SECURITY_PRIVACY.md`  

---

## 1. OAuth Scopes & Justifications

Survey Synth requests the following Google OAuth scopes. Each scope is strictly justified by user-facing core functionality:

| Scope | Category | Purpose in Survey Synth | Why a narrower scope cannot be used |
|:---|:---:|:---|:---|
| `openid` | Non-sensitive | Retrieve user subject identifier (`sub`) for account identity | Fundamental for identifying distinct user accounts locally |
| `https://www.googleapis.com/auth/userinfo.email` | Non-sensitive | Display the user's email address in the account switcher | Necessary for the user to distinguish between multiple signed-in Google accounts |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | Sensitive | Search and list Google Forms created by or accessible to the user | Google Forms are stored within Google Drive. Listing them requires drive metadata access. **Note:** Survey Synth requests metadata *only*—it does not request file contents or download file bytes (`drive.readonly` or `drive.file` are not requested). |
| `https://www.googleapis.com/auth/forms.responses.readonly` | Restricted | Read form schema structure and survey responses for user's own forms | Required to inspect questions, answer choices, and response distributions to synthesize statistically representative survey data. Survey Synth never creates or modifies form responses (`forms.body` or write scopes are not requested). |

---

## 2. Limited Use & User Data Handling Compliance

1. **Local-Only Processing:** All survey response data imported via `forms.responses.readonly` is processed exclusively in the user's local memory and encrypted local SQLite storage. No response data is ever transmitted to Survey Synth servers or external cloud backends.
2. **No Model Training:** Survey data accessed from Google Forms is **never used to train, retrain, or fine-tune general AI/ML foundation models**.
3. **No Human Access:** No human employee, contractor, or developer has access to survey response data stored on the user's device.
4. **No Advertising / Transfer:** User data is never transferred to data brokers, advertising networks, or third-party marketing services.
5. **Keyring Protection:** Access tokens are kept in transient application memory and never written to disk; refresh tokens are stored exclusively in the OS Keyring.

---

## 3. Demonstration Video Scenario (Script for Verification Submission)

When submitting for Google verification, prepare a video demonstrating the following end-to-end user workflow:

1. **Google OAuth Login Flow:**
   - Launch Survey Synth desktop app.
   - Click "Google 계정으로 로그인" (Sign in with Google).
   - System browser opens Google OAuth consent screen showing the application name, logo, and requested scopes (`drive.metadata.readonly`, `forms.responses.readonly`).
   - Complete login and show redirection to the desktop app showing the user's email address in the account badge.

2. **Form Discovery (`drive.metadata.readonly` in action):**
   - In the "새 프로젝트" (New Project) panel, show the list of the user's Google Forms fetched via metadata queries.
   - Show searching/filtering by form title.

3. **Form Import (`forms.responses.readonly` in action):**
   - Click on a selected Google Form to import.
   - Show progress bar indicating form schema retrieval and response download.
   - Show that the imported project displays the form structure (question titles, question types) and response count.

4. **Synthesis & Local Execution:**
   - Configure target response count and question percentage targets in the Targets editor.
   - Click "데이터 합성 시작" (Start Synthesis).
   - Show local mathematical optimization (HiGHS solver running in worker thread) completing the synthetic rows.

5. **Local Export & Deletion:**
   - Export synthesized results to a local CSV file chosen by the user via the native OS Save File dialog.
   - Open the exported CSV file locally to show data privacy and absence of provenance tags.
   - Demonstrate the "프로젝트 삭제" (Delete Project) button and "기기 데이터 삭제" (Delete this device's account data) button, showing complete local revocation and purge.

---

## 4. Google Cloud Console Configuration Checklist

Before submitting the verification request:
- [ ] **App Name:** `Survey Synth`
- [ ] **User Support Email:** Verified developer email address.
- [ ] **App Logo:** 120x120px PNG icon matching the Survey Synth application branding.
- [ ] **Application Home Page:** URL of the published product website or repository page.
- [ ] **Application Privacy Policy:** Publicly accessible URL hosting `PRIVACY_POLICY.md`.
- [ ] **Application Terms of Service:** Publicly accessible URL.
- [ ] **Authorized Domains:** Domain verified via Google Search Console.
- [ ] **YouTube Demo Video:** Public or unlisted YouTube link following the demonstration script in Section 3.
- [ ] **Written Justification:** Exact text from Section 1 entered into the Google Cloud OAuth Consent Screen justification forms.
