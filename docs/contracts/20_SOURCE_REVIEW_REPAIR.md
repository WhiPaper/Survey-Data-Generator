# Source Review Repair Boundary

This contract refines the `확인 필요` repair flow after an explicit source refresh or local `projects.sourceReview` restore.

## Product rule

Review diagnostics never mutate saved ValueGroups or targets by themselves. The user must choose each destructive repair explicitly.

An invalid ValueGroup may still be referenced by one or more saved targets. In that case, deleting the group must not leave the persisted target draft temporarily pointing at a deleted group.

## Explicit dependent-group removal

When the user explicitly chooses to remove an invalid ValueGroup together with its dependent targets, the renderer must perform the repair in this order:

```text
user confirms dependent-group repair
→ construct the next draft with only targets that reference that ValueGroup removed
→ persist and await that draft
→ delete the ValueGroup
→ reload groups/profile/review-visible state
```

The delete call must not run before the draft save succeeds.

If the draft save fails, keep the group and current UI draft unchanged and surface a recoverable error.

If the draft save succeeds but group deletion fails, keep the already-saved target removal rather than recreating or silently remapping targets. The invalid group remains available for a later explicit retry.

Targets unrelated to the selected ValueGroup must never be removed by this repair.

## UI behavior

The source-review dialog should make dependency consequences visible before the destructive action, for example `연결 목표 2개` and `목표 2개 제거 후 그룹 삭제`.

If the group's source question still exists, navigation to that question may remain available as a non-destructive repair path.

If the source question no longer exists, do not navigate to a fallback or unrelated question. The explicit dependent-removal action remains the repair path.

This flow is not automatic cleanup: it is one user-approved transaction over mutable Project setup. Historical Runs and immutable SourceRevisions remain unchanged.
