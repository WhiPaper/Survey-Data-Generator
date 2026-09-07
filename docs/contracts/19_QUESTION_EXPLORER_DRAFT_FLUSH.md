# Question Explorer draft flush boundary

This contract closes the lifecycle gap around v2 target-draft autosave.

## Product rule

Normal target editing remains autosaved with a short debounce. There is no visible Save button.

A lifecycle transition that can unmount the active Question Explorer or replace its source context must not silently discard a newer in-memory draft.

## One save authority

The renderer owns one active draft save coordinator per open Project.

It tracks the latest draft and the last successfully persisted serialized draft. Both debounced autosave and explicit flushes use the same `targets.draft.save` operation and the same success/error bookkeeping.

A flush is idempotent: when the latest serialized draft already matches the last successful save, it performs no write.

## Awaited transition boundaries

Before these user actions proceed, await the active draft flush:

- Project change,
- explicit `원본 업데이트`,
- logout,
- generation.

If that awaited save fails, keep the current workspace/session/source context in place, show a recoverable user-facing save error, and do not continue the requested transition.

Generation continues to save the exact draft that will be validated and synthesized before `targets.draft.start` runs.

## Window close boundary

Desktop window close uses an Electron Main ↔ renderer handshake.

Main intercepts the first close request and asks the renderer to flush the active draft. The renderer replies only after the flush settles. Main then allows the window to close.

If no Project/draft is active, the renderer acknowledges immediately. If saving fails, the renderer reports the failure and keeps the window open so the user is not silently exited with an unsaved draft.

Do not rely only on an asynchronous browser `beforeunload` handler because the renderer may be destroyed before its IPC save finishes.

## Debounce and ordering

Normal editing may debounce saves (currently about 450 ms). An explicit flush cancels any pending debounce timer before saving.

Overlapping saves must not let an older completion overwrite the coordinator's notion of the latest persisted draft. The coordinator records a save as current only when that save still corresponds to the latest draft serialization.

## Source refresh

Explicit source refresh must flush the current draft before Google capture begins. This ensures the saved target draft reviewed against the newly applied SourceRevision is the same latest draft the user saw before choosing `원본 업데이트`.

The existing source-refresh rules still apply: no automatic target remap/delete and historical Runs remain immutable.

## Non-goals

- no visible Save button,
- no new target semantics,
- no renderer-side source/profile reconstruction,
- no background Google refresh,
- no mutation of historical Runs.
