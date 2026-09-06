# Domain Model Contract

Domain types describe product meaning and remain independent of Electron, Google SDKs, SQLite rows, SDV objects, SciPy matrices, and export libraries.

## Core IDs

Use branded/string IDs for stable product entities such as:

```text
ProjectId
GoogleAccountId
FormId
QuestionId
ResponseId
SourceRevisionId
RunId
ValueGroupId
TargetId
```

## Source revision

A `SourceRevision` is an immutable snapshot of the imported Form structure and response set.

```ts
interface SourceRevision {
  id: SourceRevisionId
  projectId: ProjectId
  formSnapshotId: string
  responseCount: number
  responseSetHash: string
  capturedAt: string
}
```

Imported observations are never overwritten.

## Source scope

All run-time analysis and synthesis is scoped explicitly.

```ts
type SourceScope = {
  revisionId: SourceRevisionId
  filter:
    | { kind: "all" }
    | { kind: "submitted_between"; start: string; end: string }
}

interface FrozenSourceScope {
  scope: SourceScope
  responseCount: number
  responseSetHash: string
}
```

The scope must be frozen into the Run. Historical results must never be silently recalculated against the current project selection.

## Answer state

```ts
type AnswerSlot =
  | { state: "answered"; value: AnswerValue }
  | { state: "skipped" }
  | { state: "not_reached" }
  | { state: "indeterminate" }
```

Do not collapse these internally.

## ValueGroup

`ValueGroup` is a user-defined grouping of raw values from one question. It is not an automatic semantic classifier.

```ts
interface ValueGroup {
  id: ValueGroupId
  questionId: QuestionId
  name: string
  members: string[]
}
```

Groups may overlap. Group membership compiles to boolean derived features.

Structured Form options do not require `ValueGroup` unless the user intentionally groups multiple options into one metric.

## DerivedFeature

A derived feature is an internal numeric/boolean value used for target compilation and evaluation.

Initial families:

```text
structural: reached / answered / skipped
option indicator
checkbox option indicator
ordinal score
numeric parsed value
ValueGroup membership
time/date bucket when needed
```

Derived features are internal compute representation, not a public plugin/registry API.

## Targets

Initial public target kinds:

```ts
type Target =
  | CountTarget
  | ShareTarget
  | MeanTarget
  | ConditionalShareTarget
```

Targets store explicit semantics. Examples:

```text
final share = 0.25
delta percentage points = +0.05
relative change = +5%
exact count = 40
mean = 4.7
```

Never store an ambiguous request such as `+5%` without resolving its meaning in the UI.

A target may reference normal question features or `ValueGroup` features.

## Metric model

Internally, most targets compile to numerator/denominator contributions.

Examples:

```text
Likert mean:
  numerator = score
  denominator = answered

Busan share:
  numerator = is_busan
  denominator = eligible/all rows

Busan residents selecting bus:
  numerator = is_busan AND selected_bus
  denominator = is_busan AND transport_eligible
```

Keep this internal representation small. Do not create a general-purpose user scripting DSL.

## EditPlan

Imported source observations remain immutable, but a final dataset may replace selected original-derived rows when the user explicitly approves the plan.

```ts
interface EditPlan {
  status: "not_required" | "available" | "impossible"
  replacementCount: number
  proposedReplacements: ProposedReplacement[]
  appendOnlyOutcome: TargetOutcome
  replacementOutcome?: TargetOutcome
}
```

A proposed replacement is a complete plausible row in v2. Cell-level mutation is not required initially.

## RunSpec

A run freezes at least:

```text
FrozenSourceScope
final response count
target snapshot
ValueGroup snapshot
seed
approved EditPlan, if any
compute engine version
app version
```

A saved Run is immutable.

## Result rows

The persisted/imported source row and the run's final output row are distinct concepts.

The final dataset consists of:

```text
kept source-derived rows
+ approved replacement rows
+ requested synthetic additions
```

Internal provenance may exist for validation/debugging but is not included in normal CSV/XLSX export.
