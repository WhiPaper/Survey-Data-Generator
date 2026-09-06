# M10 Manual Release Acceptance

This checklist separates repository-automatable validation from release steps that require external authority, real services, or platform-specific evidence. Completing code tests alone does not satisfy these items.

## Google OAuth and live import

- [ ] Confirm the production Google Cloud OAuth project, consent-screen configuration, and desktop client settings.
- [ ] Publish stable privacy/support URLs and real externally reachable contact details.
- [ ] Complete any Google OAuth production review required for the requested scopes.
- [ ] On each release target, confirm Electron `safeStorage` encryption is available; on Linux, confirm the selected backend is not `basic_text` before accepting persistent Google credentials.
- [ ] On a packaged build, sign in with a real Google account, list accessible Forms, import a selected Form, and verify the immutable SourceRevision created from that observation.
- [ ] Revoke/logout and confirm the expected local token/account cleanup behavior.

## Linux x64 package acceptance

GitHub Actions run `34029637890` checked out `21bcb7a8b6ba7be29d3383556f40c30ef8e8a9a7` on the Ubuntu 22.04 release runner and completed the full configured Linux x64 artifact workflow. It provides concrete runner-level evidence for packaged Electron smoke (`PACKAGED_SMOKE_OK`), AppImage creation, and artifact upload. The uploaded `linux-x64` artifact recorded archive size `3180625317` bytes and SHA-256 digest `78fcc17a9974f7272dec9424263a8c1a82f7aa009b257529ead7771c723c768d`.

- [ ] After any packaging dependency change, rerun the full Linux x64 artifact workflow and record the exact head SHA, packaged smoke evidence, artifact size, and artifact digest.
- [ ] Launch the AppImage on a representative Linux device or VM and verify the packaged Python engine is discovered without a system Python dependency.
- [ ] Confirm the running app groups with its installed launcher/taskbar entry rather than appearing as an unrelated window.
- [ ] Confirm the representative Linux environment provides a secure Electron `safeStorage` backend rather than `basic_text`; if it does not, credential persistence must fail safely and the environment must not be accepted for Google login.

Runner-level Linux packaged smoke may be claimed only for an evidenced commit. Do not treat a GitHub-hosted xvfb result as representative Linux desktop/device acceptance, secure `safeStorage` backend acceptance, or launcher/taskbar association evidence.

## Packaging metadata, dependency scope, and warnings

The desktop package includes a product description and a stable Linux desktop identity. The pinned electron-builder 26.15.3 schema does not expose a supported missing-dependency hard-fail option. Automated release validation therefore treats `package:desktop:dir` followed by the packaged Electron smoke as the primary runtime dependency gate: the produced app must launch and exercise representative packaged native/runtime paths before artifact creation proceeds.

The v2 synthesis contract and implementation use SDV `GaussianCopulaSynthesizer`. CTGAN, TVAE, and PAR are not product synthesis paths. SDV 1.38 tolerates those optional neural-model dependencies being unavailable when Gaussian Copula is used, so the PyInstaller bundle excludes external `ctgan`, `deepecho`, `torch`, `triton`, `nvidia`, and `cuda` modules. This keeps the Gaussian Copula implementation while avoiding the Linux Torch/CUDA payload that previously dominated artifact size.

A source-level regression test runs Gaussian Copula fit/sample while actively blocking those neural/GPU module roots. A fresh packaged-artifact workflow is still required after this bundle change because only the built binary and packaged Electron smoke can prove that the optimized artifact contains all dependencies needed by the exercised packaged runtime.

- [ ] Confirm the release owner/publisher identity before adding or relying on `author`/publisher metadata. Do not invent this value merely to silence a packaging warning.
- [ ] Review the final installer/application icon. The current configuration does not provide a custom brand icon, so electron-builder may use its default Electron icon until the release owner supplies or explicitly accepts an asset.
- [ ] If packaging emits dependency or collector warnings, classify whether they affect the packaged runtime; do not add unsupported builder options or change product dependencies merely to silence warnings.
- [ ] Compare Windows/Linux artifact sizes after the neural/GPU exclusion and investigate any unexpectedly large remaining payload before public distribution.

## Publishing

Certificate/code-signing is outside the current release plan and is not a release acceptance gate.

- [ ] Confirm the release owner/publisher identity used for package metadata.
- [ ] Confirm GitHub Release publishing permissions and any required release secrets if repository publishing is enabled.
- [ ] Review the final installer/application icon and other brand assets supplied by the release owner.
- [ ] Verify final artifact names, version metadata, published checksums, and release notes.

Publishing and release secrets must not be enabled or invented by repository code before the release owner explicitly approves the process.

## Updater decision

The v2 application does not currently include an automatic updater. Do not add updater code, manifests, or publishing steps unless a future release process explicitly decides that an updater is required and defines its publishing and trust model.
