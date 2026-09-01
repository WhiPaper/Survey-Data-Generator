# Targets, TargetCompiler & Feasibility

## Final-dataset semantics

Every user target applies to the final combined dataset.

Example:

```text
original = 50
target final N = 200
synthetic = 150
```

If the user asks for female = 55%, that means 55% of the final 200 rows.

Core equation:

```text
FinalMetric
=
OriginalContribution (constant)
+
SyntheticContribution (solver-controlled)
```

Original rows are never modified.

## Target model

Unspecified metrics are not user constraints; they are preservation requests.

Exact count is hard.

Percentage and mean targets are approximate in the sense that they resolve to the nearest mathematically representable result.

## Metric abstraction

```ts
interface CompiledMetric {
  id: MetricId

  kind:
    | "count"
    | "ratio"
    | "mean"
    | "sum"

  numerator: MetricAggregate
  denominator?: MetricAggregate

  scope: MetricScope
}

interface MetricAggregate {
  originalValue: number
  expression: SyntheticMetricExpression
}
```

Metric scope:

```text
all responses
question eligibility
condition / detailed-goal population
```

## Count target

Original female = 20, final female target = 110:

```text
20 + syntheticFemale = 110
```

Therefore syntheticFemale must equal 90.

If original contribution already exceeds an exact final target, the target is infeasible before optimization.

## Ratio target

```text
N / D = r
```

Compile as:

```text
N - rD = 0
```

For fixed total final N this is equivalent to a count target, but keeping the ratio form generalizes to conditional populations.

Example:

```text
female AND score5
----------------- = 0.70
female
```

becomes:

```text
femaleScore5 - 0.70*female = 0
```

## Representability

Do not use arbitrary percentage tolerances.

For final N=37 and target=50%, exact 18.5 rows are impossible. The feasible nearest values are based on integer counts, e.g. 18/37 or 19/37.

The same principle applies to ordinal means whose score sums are discrete.

## Ranges

Count range:

```text
100 ≤ femaleCount ≤ 120
```

Ratio range:

```text
0.50 ≤ F/D ≤ 0.60
```

linearizes to:

```text
F - 0.50D ≥ 0
F - 0.60D ≤ 0
```

Range bounds are hard.

## Means

Target mean:

```text
sum(values) / answeredCount = 4.2
```

linearizes to:

```text
sum(values) - 4.2*answeredCount = 0
```

The denominator is answered count, not all responses.

Skipped/not_reached/indeterminate do not enter a question mean denominator.

## Response rate

```text
answered
----------------
answered + skipped
```

Only confirmed eligible responses are in the denominator.

High indeterminate share lowers confidence/reliability.

## Checkbox

Option percentage is an independent marginal. Checkbox percentages do not sum to 100.

Average selection count is a mean:

```text
sum(selectionCount) / answeredCount
```

Per-row minimum/maximum selections are row constraints, not aggregate metrics.

## Date/time/numeric row constraints

Examples:

- numeric min/max — row constraint
- date allowed range — row constraint
- time allowed range — row constraint

Distribution goals such as month share or time-bin share are aggregate metrics.

## Conditional detailed goals

Population and outcome are compiled into indicators.

Example:

```text
female AND age30s AND selectedServiceA
```

can define a population.

A conditional percentage is:

```text
population AND outcome
----------------------
population
```

A conditional mean is:

```text
sum(value * populationIndicator)
--------------------------------
population AND answered
```

Internal condition AST may support AND/OR; v1 UI should remain simple and need not expose every logical operator.

## Compiled target set

```ts
interface CompiledTargetSet {
  targetResponseCount: number
  syntheticResponseCount: number

  aggregateConstraints: CompiledAggregateConstraint[]
  rowConstraints: CompiledRowConstraint[]

  preservationRequests: PreservationRequest[]
}
```

## Priorities

Expose semantic priority names rather than hard-coded public numeric weights:

```text
form_hard
user_exact
user_approx
user_range
preserve_marginal
preserve_relationship
preserve_temporal
diversity
```

The solver adapter maps these to internal weights/lexicographic behavior.

Higher-priority constraints must not be broken to improve lower-priority goals.

## Preservation

If the user targets female=55%, do not also preserve female=40% as a competing objective.

Unrelated preservation requests remain active.

User adjustment of one metric does not automatically disable all relationships involving that question.

## Feasibility

```ts
interface FeasibilityReport {
  status:
    | "feasible"
    | "infeasible"
    | "unknown"

  strategy:
    | "resampling_only"
    | "mutation_required"
    | null

  issues: FeasibilityIssue[]
  bounds: FeasibleBound[]
}
```

Three stages:

1. analytical/static impossibility
2. user-goal mathematical conflicts via small LP/MIP
3. structural/form-routing feasibility

Examples detected without full synthesis:

- target final N < source N
- exact category count below immutable original contribution
- mutually inconsistent single-choice counts
- impossible ratio bounds
- impossible ordinal mean bounds

## Error locations

```ts
type TargetLocation =
  | { type: "question-option"; questionId: QuestionId; optionKey: OptionKey }
  | { type: "question-mean"; questionId: QuestionId }
  | { type: "question-response-rate"; questionId: QuestionId }
  | { type: "group"; groupId: GroupId }
  | { type: "detailed-goal"; goalId: string }
  | { type: "target-size" }
```

Issues map to concrete UI fields.

Suggestions may be typed patches such as:

- set exact
- set range
- remove target

Do not silently apply them.

## Solver-independent linear IR

```ts
interface LinearConstraint {
  terms: LinearTerm[]
  relation: "eq" | "lte" | "gte"
  rhs: number
}

interface LinearTerm {
  variableId: string
  coefficient: number
}
```

Flow:

```text
UI
→ ProjectTargets
→ TargetCompiler
→ CompiledMetric
→ ConstraintCompiler
→ LinearConstraint IR
→ OptimizationBackend
→ HiGHS implementation
```

No HiGHS-specific representation leaks upward.
