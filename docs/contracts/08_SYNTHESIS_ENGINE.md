# Synthesis Engine Contract

## Philosophy

Core pipeline:

```text
Weighted resampling
→ constrained mutation
→ global repair
→ validation
```

Original responses remain untouched.

Suggested detailed stages:

```text
Compiled Targets
→ FeasibilityChecker
→ FeatureCompiler
→ WeightOptimizer
→ RowAllocator
→ StructuralMutation
→ ValueMutation/Repair
→ GlobalRepair
→ DeferredFieldGenerator
→ Validator
```

## Solver boundary

```ts
interface OptimizationBackend {
  solveLinear(problem: LinearProblem, ...): Promise<LinearSolution>
  solveMixedInteger(problem: MixedIntegerProblem, ...): Promise<MipSolution>
}
```

`synthesis-core` defines the interface but does not import a concrete optimization library.

Initial implementation candidate: HiGHS via a TS/Node-compatible WASM package, wrapped inside the sidecar.

## Seed

A synthesis run stores a seed.

Same:

- source revision
- target snapshot
- seed
- engine version

must reproduce the same **structured** synthetic result.

Different seeds are allowed to coincide when the feasible space is constrained.

AI-generated free text is persisted in the run and is not promised to be reproducible from the external model alone.

## Feature space

Each source row maps to selected features such as:

- categorical marginals
- ordinal/numeric values
- checkbox option indicators
- checkbox co-occurrence
- selection-count distribution
- important interaction features
- reachability/answered/skipped indicators
- temporal bins/features
- detailed-goal population/outcome indicators

Do not generate every possible pair/cell.

## WeightOptimizer

Solve continuous nonnegative source-template weights:

```text
w_i ≥ 0
Σw_i = syntheticCount
```

Objective combines:

- target feature deviations
- preservation feature deviations
- concentration penalty so weights do not collapse onto a few source rows

Continuous LP is the main scalable stage.

## RowAllocator

Convert continuous weights to integer template counts:

1. floor
2. largest remainder
3. when important exact metrics are damaged, solve a small neighborhood MIP

## Synthetic drafts

Synthetic rows start from selected original templates.

Internal `templateResponseId` may be stored for debugging/reproducibility but is not exported by default.

## Mutation strategies

Candidate mutations provide:

- proposed value change
- cost
- feature deltas
- optional structural impact

Cost examples:

- categorical — conditional rarity / relationship disruption
- ordinal — normalized score distance
- numeric — percentile distance
- checkbox — Jaccard and selection-count change
- time — circular distance

FeatureAccumulator is updated incrementally rather than fully reprofiling after every candidate.

## Structural mutation

See `05_FORM_LOGIC.md`.

Changing a branch driver requires reachability repair and donor initialization.

Unsafe structural candidates are rejected before GlobalRepair.

## Donor policy

Select structurally compatible donors from a hard filtered pool.

Use seed-stable, distance-weighted selection among top-K similar rows to preserve diversity.

Never automatically donor-copy:

- identifiers
- personal identifiers
- free text
- file uploads
- timestamps

## Global repair

GlobalRepair may formulate a MIP over mutation candidates:

```text
minimize
hard violations
then user-target error
then preservation error
then mutation cost
then duplicate penalty
```

The concrete formulation may evolve, but priority semantics are stable.

## Checkbox

Always model:

- option marginals
- selection-count distribution

Also preserve important:

- option-option co-occurrence
- within-question relationship patterns

When the user changes option A, keep unrelated B/C marginals and original co-selection patterns as stable as possible.

## Grid

Rows are ordinary question features connected by group metadata.

For ordinal-like multiple-choice grids:

- overall grid mean may be user-facing
- row means/distributions can be expanded
- preserve cross-row relationships

Checkbox grids:

- row-level marginals
- within-row co-selection
- cross-row structure
- selection-count behavior

## Numeric

Default user control: mean.

Advanced:

- median
- range
- bins

Generated values preserve plausible range/precision patterns unless the user explicitly constrains them.

## Date / time

Date:

- preserve source period, density, weekday/month patterns
- support general dates and birth-date semantics
- preserve meaningful intervals/order relationships

Time-of-day:

- preserve time distribution and minute precision
- use circular distance for repair

Duration:

- preserve duration distribution
- advanced mean/bins/range

## Timestamp

Timestamp is structured, not deferred.

Default synthetic timestamps are within the observed source response period and preserve:

- date density
- weekday
- time-of-day
- burst/inter-arrival tendencies

Modes may include:

- within original period
- after original period
- manual period

## File upload

Default synthetic answer: blank.

Never duplicate/download/create actual Drive files.

Optional placeholder mode creates only synthetic display metadata/filename.

## Deferred fields

Run only after structured rows are final:

- new identifiers
- personal-data-safe placeholders
- file placeholders
- free text / AI last

Failure of an optional AI free-text item does not invalidate the already valid structured dataset.

## Validation

Two layers:

### StructuralValidator

Must pass before a run can be considered valid.

Checks:

- question value validity
- confirmed routing consistency
- required questions where reachability is confirmed
- hard row constraints
- final row count
- exact user constraints

### StatisticalValidator

Checks:

- approximate target achievement
- range goals
- marginals
- selected relationships
- temporal preservation
- duplicate diagnostics

Validator and solver must use the same FeatureSpace definitions to avoid metric mismatch.

Only structurally valid runs are exportable.
