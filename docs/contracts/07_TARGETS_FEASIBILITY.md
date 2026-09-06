# Targets & Feasibility

## Final-dataset semantics

Every target applies to the final result.

```text
source scope count = N0
requested final count = Nf
requested synthetic additions = Nf - N0
```

Target contribution is always:

```text
kept source contribution
+ approved replacement contribution
+ synthetic addition contribution
```

Append-only planning fixes the source contribution. Replacement planning may remove selected source-derived rows from the final dataset only through an approved EditPlan.

## Public target vocabulary

The v2 public target vocabulary is intentionally small:

```text
count
share
mean
conditional_share
```

Do not add a generic target language in v2.

Every public target has a stable `TargetId`. Array position is not target identity.

```text
TargetId = string
```

`count` and `share` separate the metric from the thing being measured through `TargetSubject`:

```text
TargetSubject =
  option(questionId, optionKey)
  | checkbox_option(questionId, optionKey)
  | value_group(valueGroupId)
```

A single structured Form option does not require a ValueGroup. ValueGroup is reserved for intentionally grouping multiple raw values.

`conditional_share` remains depth-1 in v2:

```text
population = ValueGroup
outcome = checkbox option
```

Arbitrary boolean expressions, custom denominators, custom formulas, scripting, and user-defined target weights are outside v2.

## Cardinality and engine boundaries

A target set is not semantically invalid merely because it contains several valid targets. The product contract allows each target kind `0..N` and requires at least one target per Run.

Static/domain validation decides whether each target is meaningful and computable. Feasibility/selection/replacement decides whether valid targets can be satisfied together.

Temporary engine implementation limits must be reported as `domain_unsupported`; they are not part of the public target semantics. Phase 1 exposes the `count` contract without compiling it into the current engine and preserves the current single-mean and single-unconditional-share execution boundaries without generalizing the solver. Executable count and multiple categorical targets are Phase 2 work; mean `0..N` is Phase 3 work.

## Metric compilation

Most targets compile to row-level numerator/denominator features.

For a final ratio `r`:

```text
N0 + n·x = r(D0 + d·x)
```

which becomes a linear constraint:

```text
(n - r d)·x = rD0 - N0
```

For a mean, numerator is the value/score sum and denominator is the answered/eligible indicator.

For a conditional share, numerator and denominator both include the condition.

Public targets remain product-specific, while solver-facing compiled metrics may use a generalized internal representation.

## Examples

Likert mean:

```text
numerator = satisfaction score
denominator = answered
```

Structured option share:

```text
numerator = selected_seoul
denominator = region_eligible
```

ValueGroup share:

```text
numerator = is_fruit
denominator = eligible rows
```

Checkbox conditional share:

```text
numerator = is_busan AND selected_bus
denominator = is_busan AND transport_eligible
```

Checkbox option shares are independent and need not sum to 100%.

## Representability

Counts are exact when feasible.

Ratios and means may be impossible to represent exactly with integer rows/score sums. The result should use the nearest feasible representation and report the achieved value rather than apply an arbitrary generic epsilon.

## Target outcomes

Target results use one shape everywhere target-level outcomes are compared or frozen:

```text
TargetOutcome {
  targetId
  kind
  requested
  achieved
  absoluteError
  exact
  numeratorCount?
  denominatorCount?
}
```

Synthesis success, historical Run results, and EditPlan comparison use:

```text
TargetSetOutcome {
  targets: TargetOutcome[]
}
```

Target identity must survive draft edits, execution, replacement comparison, and historical Run snapshots.

## Target issues

Target-aware diagnostics use:

```text
TargetIssue {
  targetIds: TargetId[]
  code:
    out_of_range
    | invalid_subject
    | immutable_source_conflict
    | zero_denominator
    | target_conflict
    | candidate_support
    | domain_unsupported
  message
}
```

A solver conflict does not require a minimal unsat core. When a smaller affected set cannot be identified cheaply, attach the issue to all relevant targets.

Mathematical/domain conflict and candidate support failure are different diagnostics. Invalid question, option, or ValueGroup references use `invalid_subject` with the affected TargetId.

## Semantics of changes

These are different target requests:

```text
final share 25%
+5 percentage points
+5% relative to current share
final exact count 40
+5 people
```

Resolve the requested semantics before compilation. A Run snapshot freezes the resolved absolute target value; any original editing intent may be stored separately.

## Feasibility

Use simple static checks when they provide clear diagnostics, then rely on the same SciPy MILP formulation used for selection.

Do not maintain a separate solver architecture for feasibility.

Planning order:

```text
1. validate target semantics and obvious bounds
2. append-only MILP
3. if infeasible, replacement-enabled MILP minimizing replaced source rows
4. if still infeasible, report unsupported candidate/domain requirement
```

Examples of early diagnostics:

- final count below source-scope count
- requested mean beyond the question's possible score range
- requested final category count already below immutable append-only source contribution
- conditional denominator is zero/unsupported
- duplicate TargetId
- invalid question/option/ValueGroup reference

## Original replacement

The replacement-enabled solve should minimize the number of replaced original-derived rows before secondary considerations.

The computed plan is not automatically applied. Return both append-only and replacement-enabled outcomes to the application for user approval.

Start with complete-row replacement. Do not optimize edit distance or individual cell mutations in v2.

## Candidate support

A mathematically valid target can still be infeasible with the available candidate pool.

The engine may regenerate a larger or conditionally enriched candidate pool before declaring final infeasibility. This is preferable to adding a custom repair engine.

Structured Form options may generate values that are valid in the Form schema even when unseen in observed responses. Arbitrary short-text values require observed or explicit user-provided support.
