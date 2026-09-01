# Packaged sidecar staging

M0 runs the sidecar with local Node tooling. A later packaging spike will place the
self-contained sidecar executable in this directory or configure an equivalent Tauri
resource path. The Rust bridge accepts `SURVEY_SYNTH_SIDECAR_EXECUTABLE` for that
transition and keeps the NDJSON protocol unchanged.
