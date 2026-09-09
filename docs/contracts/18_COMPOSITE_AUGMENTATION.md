# Composite Augmentation Contract

`AugmentationBatchDraft` is editable orchestration above Runs. Each stable `ruleId` has a SourceScope, `add N` or `final N` count, zero or more targets/intents, and a seed. A Run remains one frozen SourceRevision, one SourceScope, target snapshot, seed, and final scoped result.

At batch start Electron Main freezes the project's current source revision exactly once and resolves every scope against it. v1 uses `overlapPolicy: "reject"`: any shared source response identity rejects the batch before child synthesis begins. `add N` resolves to scoped source count plus N; targetless `add N` is valid ordinary synthesis, not a fake preservation target. Replacement approval remains an explicit child-Run decision.

An immutable CompositeResult stores project, base revision, overlap policy, timestamp, final count, and ordered child Run associations with rule IDs and entered count specs. Its rows are deterministically reconstructed without compute:

```text
untouched base rows outside every child scope
+ each child Run's complete persisted final scoped rows
= composite final rows
```

The composer verifies child project/revision/scope evidence and disjoint membership. Final count is base count plus each child `(finalResponseCount - scopeResponseCount)`. Export uses the base revision Form snapshot, shared logical table, stable ordering, and no provenance columns.

The editable batch draft is autosaved independently from both the project’s legacy single-run target draft and saved CompositeResults. It stores each rule’s editable target draft and count mode; it is never used to reinterpret a historical CompositeResult.
