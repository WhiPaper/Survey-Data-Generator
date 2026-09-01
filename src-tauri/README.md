# Thin host

`src-tauri` owns process lifecycle, transport validation, request correlation, and
Tauri invocation. Business behavior remains in the TypeScript sidecar.

Development sidecar selection:

- `SURVEY_SYNTH_SIDECAR_EXECUTABLE`: packaged/self-contained executable path.
- `SURVEY_SYNTH_SIDECAR_SCRIPT`: development JavaScript entrypoint run with `node`.

The default development script is `apps/sidecar/dist/main.js` relative to the repository.
