# M10 Manual Release Acceptance

This checklist separates repository-automatable validation from release steps that require external authority, credentials, real services, or platform-specific evidence. Completing code tests alone does not satisfy these items.

## Google OAuth and live import

- [ ] Confirm the production Google Cloud OAuth project, consent-screen configuration, and desktop client settings.
- [ ] Publish stable privacy/support URLs and real externally reachable contact details.
- [ ] Complete any Google OAuth production review required for the requested scopes.
- [ ] On each release target, confirm Electron `safeStorage` encryption is available; on Linux, confirm the selected backend is not `basic_text` before accepting persistent Google credentials.
- [ ] On a packaged build, sign in with a real Google account, list accessible Forms, import a selected Form, and verify the immutable SourceRevision created from that observation.
- [ ] Revoke/logout and confirm the expected local token/account cleanup behavior.

## Linux x64 package acceptance

- [ ] Build the x64 AppImage on an actual Linux runner matching the release baseline.
- [ ] Run the packaged Electron smoke under that Linux environment and record the successful evidence.
- [ ] Launch the AppImage on a representative Linux device or VM and verify the packaged Python engine is discovered without a system Python dependency.
- [ ] Confirm the running app groups with its installed launcher/taskbar entry rather than appearing as an unrelated window.
- [ ] Confirm the representative Linux environment provides a secure Electron `safeStorage` backend rather than `basic_text`; if it does not, credential persistence must fail safely and the environment must not be accepted for Google login.

Until these checks have evidence, do not claim that Linux packaged smoke has passed.

## Signing and publishing

- [ ] Confirm the release owner/publisher identity used for package metadata.
- [ ] Provide and authorize any Windows/Linux signing credentials only through the approved release process.
- [ ] Confirm GitHub Release publishing permissions and any required release secrets.
- [ ] Review the final installer/application icon and other brand assets supplied by the release owner.
- [ ] Verify final artifact names, version metadata, signatures where applicable, and published checksums/release notes.

Signing, publishing, and release secrets must not be enabled or invented by repository code before these authorities and procedures are explicitly approved.

## Updater decision

The v2 application does not currently include an automatic updater. Do not add updater code, manifests, or publishing steps unless a future release process explicitly decides that an updater is required and defines its signing/trust model.
