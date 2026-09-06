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

GitHub Actions run `34028158373` checked out `b7be0544aa9e89024740fbffa0a560103d483f23` on the Ubuntu 22.04 release runner and provides concrete runner-level evidence for x64 AppImage creation, packaged Electron smoke (`PACKAGED_SMOKE_OK`), and artifact upload. The uploaded `linux-x64` artifact recorded SHA-256 digest `dc68fa6b8241e3e481cf9c634c3e005bca47e1ed4d6cdc89544eb7ec6c234d92`.

- [ ] For the final release candidate, build the x64 AppImage on an actual Linux runner matching the release baseline.
- [ ] For the final release candidate, run the packaged Electron smoke under that Linux environment and record the successful evidence.
- [ ] Launch the AppImage on a representative Linux device or VM and verify the packaged Python engine is discovered without a system Python dependency.
- [ ] Confirm the running app groups with its installed launcher/taskbar entry rather than appearing as an unrelated window.
- [ ] Confirm the representative Linux environment provides a secure Electron `safeStorage` backend rather than `basic_text`; if it does not, credential persistence must fail safely and the environment must not be accepted for Google login.

Runner-level Linux packaged smoke may be claimed for the evidenced commit above. Do not treat that result as representative Linux desktop/device acceptance, secure `safeStorage` backend acceptance, or launcher/taskbar association evidence.

## Packaging metadata and warnings

The desktop package includes a product description and a stable Linux desktop identity. The pinned electron-builder 26.15.3 schema does not expose a supported missing-dependency hard-fail option. Automated release validation therefore treats `package:desktop:dir` followed by the packaged Electron smoke as the primary runtime dependency gate: the produced app must launch and exercise representative packaged native/runtime paths before artifact creation proceeds.

GitHub Actions run `34028158373` also demonstrated that the Windows directory package and packaged Electron smoke pass before NSIS artifact creation. The remaining Windows failure occurred when NSIS tried to open an electron-builder template through a 261-character `pnpm dlx` cache path. The release workflow therefore places the Windows pnpm cache under the shorter `${{ runner.temp }}` path before `dlx` packaging; this is a build-tool path-length mitigation, not a product-runtime dependency change.

- [ ] Confirm the release owner/publisher identity before adding or relying on `author`/publisher metadata. Do not invent this value merely to silence a packaging warning.
- [ ] Review the final installer/application icon. The current configuration does not provide a custom brand icon, so electron-builder may use its default Electron icon until the release owner supplies or explicitly accepts an asset.
- [ ] If packaging emits dependency or collector warnings, classify whether they affect the packaged runtime; do not add unsupported builder options or change product dependencies merely to silence warnings.

## Signing and publishing

- [ ] Confirm the release owner/publisher identity used for package metadata.
- [ ] Provide and authorize any Windows/Linux signing credentials only through the approved release process.
- [ ] Confirm GitHub Release publishing permissions and any required release secrets.
- [ ] Review the final installer/application icon and other brand assets supplied by the release owner.
- [ ] Verify final artifact names, version metadata, signatures where applicable, and published checksums/release notes.

Signing, publishing, and release secrets must not be enabled or invented by repository code before these authorities and procedures are explicitly approved.

## Updater decision

The v2 application does not currently include an automatic updater. Do not add updater code, manifests, or publishing steps unless a future release process explicitly decides that an updater is required and defines its signing/trust model.
