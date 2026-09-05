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

## Initial target kinds

```text
count
share
mean
conditional_share
```

Do not add a generic target language in v2.

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

## Examples

Likert mean:

```text
numerator = satisfaction score
denominator = answered
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

## Semantics of changes

These are different target requests:

```text
final share 25%
+5 percentage points
+5% relative to current share
final exact count 40
+5 people
```

Resolve the requested semantics before compilation.

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

## Original replacement

The replacement-enabled solve should minimize the number of replaced original-derived rows before secondary considerations.

The computed plan is not automatically applied. Return both append-only and replacement-enabled outcomes to the application for user approval.

Start with complete-row replacement. Do not optimize edit distance or individual cell mutations in v2.

## Candidate support

A mathematically valid target can still be infeasible with the available candidate pool.

The engine may regenerate a larger or conditionally enriched candidate pool before declaring final infeasibility. This is preferable to adding a custom repair engine.

Structured Form options may generate values that are valid in the Form schema even when unseen in observed responses. Arbitrary short-text values require observed or explicit user-provided support.
