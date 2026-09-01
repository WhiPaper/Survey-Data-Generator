# Survey Synth

M0 establishes the desktop process boundary:

```text
React → Tauri invoke → Rust host → NDJSON → TypeScript sidecar
```

## Development

Requirements: Node.js, pnpm, and Rust.

```text
pnpm install
pnpm check
```

The sidecar uses local Node tooling in M0. Its production replacement is staged through
`src-tauri/binaries/` without changing the NDJSON protocol.
