# Targets and feasibility

This contract keeps the public target vocabulary intentionally small while allowing the backend to compile those targets into solver-facing metrics.

## Public target vocabulary

The v2 public API exposes only four target kinds:

- `count`
- `share`
- `mean`
- `conditional_share`

The public contract does not expose a generic formula or boolean-expression DSL. More complex solver metrics remain an internal implementation detail.

Every public target has a stable `TargetId`. A `TargetId` must be unique within a Run and is preserved through execution, diagnostics, EditPlan comparison, frozen snapshots, and final outcomes.

## TargetSubject

Depth-1 target subjects are explicit and finite:

```ts
type TargetSubject =
  | { kind: "option"; questionId: string; optionKey: string }
  | { kind: "checkbox_option"; questionId: string; optionKey: string }
  | { kind: "value_group"; valueGroupId: string };
```

A structured single-choice option does not require a ValueGroup. A checkbox option can also be targeted directly. ValueGroups remain useful for grouping several observed categorical/text values under one reusable population or subject.

The public target shapes are conceptually:

```ts
type CountTarget = {
  id: TargetId;
  kind: "count";
  subject: TargetSubject;
  value: number;
};

type ShareTarget = {
  id: TargetId;
  kind: "share";
  subject: TargetSubject;
  value: number; // 0..1
};

type MeanTarget = {
  id: TargetId;
  kind: "mean";
  questionId: string;
  value: number;
};

type ConditionalShareTarget = {
  id: TargetId;
  kind: "conditional_share";
  population: { kind: "value_group"; valueGroupId: string };
  questionId: string;
  optionKey: string;
  value: number; // 0..1
};
```

`conditional_share` intentionally stays depth-1 in v2: its population is a ValueGroup and its numerator is one checkbox option. Nested arbitrary conditions are not part of the public contract.

## Cardinality and execution boundaries

Target cardinality is a product semantic, not a permanent API restriction. Compatible target sets should eventually flow to the feasibility solver rather than being rejected simply because several targets were supplied.

The engine supports multiple depth-1 categorical `count` and `share` targets in one Run. Count targets are exact constraints; share targets use the nearest integer-row representation. Both participate in candidate support, append-only selection, evaluation, and replacement planning.

The engine accepts `0..N` mean targets. Each valid ordinal target is compiled to an independent solver metric; a target-free categorical Run does not invent an ordinal target merely to enter the synthesis pipeline.

Engine capability failures are surfaced as structured `domain_unsupported` issues rather than encoded as permanent public-schema restrictions.

## Structured options and observed support

Structured Form options are schema-backed. A direct `option` or `checkbox_option` subject remains a valid target even when that option has zero observations in the selected SourceScope.

For zero-observed structured options, the backend constructs the canonical AnswerSlot from the Form schema. Candidate generation can inject that canonical structured value after sampling the rest of the row, so a valid schema-backed option is not rejected merely because it is absent from source observations.

Text ValueGroups are different. The system must not invent unseen raw text values. ValueGroup compilation uses observed source cells for its members; if the selected SourceScope provides no usable member support, the result is a structured `candidate_support` issue.

## Static validation vs feasibility

Static/domain validation answers questions such as:

- Does a referenced question exist?
- Is an `option` subject attached to a single-choice question?
- Is a `checkbox_option` attached to a multi-choice question?
- Does the option key exist in the Form schema?
- Is a requested share within `[0, 1]`?
- Is a requested mean within the ordinal domain?

Feasibility answers different questions after valid targets have been compiled:

- Can the immutable source plus allowed synthetic rows reach the requested target values?
- Does a conditional population have a usable denominator?
- Does the candidate pool contain enough support?
- Do several targets conflict when considered together?

The public boundary should not confuse a valid-but-infeasible target with an invalid target description.

## Target issues

Target-related infeasibility is structured and target-aware:

```ts
type TargetIssue = {
  targetIds: TargetId[];
  code:
    | "out_of_range"
    | "invalid_subject"
    | "immutable_source_conflict"
    | "zero_denominator"
    | "target_conflict"
    | "candidate_support"
    | "domain_unsupported";
  message: string;
};
```

Milestone names are not part of validation or infeasibility messages. Messages describe the actual capability or conflict.

## Outcomes

All target-bearing result surfaces use the same target-aware representation:

```ts
type TargetOutcome = {
  targetId: TargetId;
  kind: "count" | "share" | "mean" | "conditional_share";
  requested: number;
  achieved: number;
  absoluteError: number;
  exact: boolean;
  numeratorCount?: number;
  denominatorCount?: number;
};

type TargetSetOutcome = {
  targets: TargetOutcome[];
};
```

The same structure is used for direct synthesis success, append-only and replacement EditPlan previews, the selected persisted Run outcome, and `runs.get`. `TargetId` is the stable join key between requested intent, diagnostics, preview, and achieved result.

## Frozen Run targets

Run snapshots freeze executable target meaning at Run time. They do not retain only a mutable ValueGroup ID.

A frozen `value_group` subject contains the ValueGroup's ID, question, name, and member list as they existed when the Run started. Conditional populations are frozen in the same way. Structured `option` and `checkbox_option` subjects retain the stable question/option identifiers from the frozen Form revision.

This separation means later draft edits do not rewrite historical Run intent.

## Internal compilation

The backend may compile public targets to a more generic internal metric representation, for example a solver-facing `CompiledMetric[]`. That representation is not a public formula DSL and should not leak into renderer contracts.

The implementation may evolve this internal representation without widening the public target union. Internal genericity is an implementation boundary, not an extension point for clients.

## Phase 5 boundary: demand-gated extensions

Phase 5 is a deliberate non-implementation phase for v2. The following capabilities are not accepted by the public RPC contract and must not be smuggled through optional fields, untyped payloads, renderer-only conventions, or solver-specific escape hatches:

- arbitrary `AND` / `OR` population expressions
- nested conditional depth 3 or greater
- custom denominator expressions
- custom formulas
- user-defined target weights or priorities
- metric plugins
- target scripting or a generic target DSL

Unknown target kinds and unknown fields on the four supported target shapes are rejected at the contract boundary. In particular, adding fields such as `formula`, `denominator`, `weight`, `priority`, `plugin`, `script`, or arbitrary condition trees to an otherwise supported target does not opt into an experimental capability.

`conditional_share` remains exactly `ValueGroup population + checkbox option`. A request that needs a compound population such as `Q1=A AND Q2=B` is outside v2 even if the solver could theoretically encode it.

These features are reconsidered only after repeated product scenarios establish a concrete need. Such a change requires an explicit contract revision covering public semantics, validation, freezing, candidate support, feasibility, replacement, outcomes, migration/compatibility, and tests. It must not be introduced solely by generalizing `CompiledMetric`.

The regression suite contains negative public-contract tests for these Phase 5 shapes so future solver refactors cannot accidentally expand the v2 API surface.

## Implementation sequencing

Phase 1 aligned identity, subject modeling, structured option support, frozen snapshots, issues, and outcomes. Phase 2 arrayized categorical targets and added exact count metrics. Phase 3 arrayized mean metrics. Phase 4 added authoritative SourceScope profiling, persisted drafts, and server-side intent resolution. Phase 5 freezes the public boundary above until demonstrated product demand justifies a separate contract change.
