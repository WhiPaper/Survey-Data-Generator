# Testing & Quality Gates

Tests should enforce product scenarios and invariants, not the removed v1 implementation architecture.

## Core scenario fixtures

At minimum maintain fixtures for:

1. submitted-time SourceScope + final count increase
2. Likert/ordinal mean target
3. single-choice share target
4. user-defined short-text ValueGroup share
5. conditional checkbox share
6. overlapping ValueGroups
7. append-only infeasible target
8. minimal original-row replacement plan
9. branching Form with reached/skipped/not_reached/indeterminate states
10. timestamp distribution and duplicate sanity

## Hard invariants

Every completed Run must satisfy:

```text
frozen source scope used consistently
final row count correct
only approved original-derived rows replaced
imported source observations unchanged
confirmed Form/routing violations = 0
allowed structured values valid
exact count targets exact when feasible
ratio/mean result is the selected feasible representation
```

## Target math tests

Test target compilation with direct expected equations/contributions for:

- count
- share
- mean
- conditional share
- checkbox overlap
- zero/variable denominators
- percentage points vs relative percent

## Feasibility tests

Use the same SciPy MILP path used for final selection where practical.

Test:

- source count greater than requested final count
- impossible ordinal mean
- immutable append-only contribution above a requested final share/count
- mutually conflicting targets
- candidate-support failure
- replacement-enabled solution requiring minimum row count

## ValueGroup tests

Verify:

- manual membership
- overlap
- frozen group snapshot in a Run
- source refresh does not silently add new values to a group

Do not test nonexistent automatic semantic understanding.

## Form logic tests

Keep representative fixtures for:

```text
no branching
branch to section
branch to submit
nested branch
optional section
required downstream question
ambiguous/restart behavior
```

Verify conservative evidence and hard final-row validation.

No donor/mutation tests are required in v2.

## Candidate and quality tests

Use representative datasets to verify that candidate generation and selected results do not collapse into obvious row copies.

Engineering diagnostics may include:

- exact duplicate rate/fingerprint concentration
- SDMetrics quality outputs
- datetime distribution comparison

These diagnostics are not themselves universal hard product targets; establish benchmark thresholds from representative fixtures rather than arbitrary global constants.

## Timestamp tests

For a time-bounded SourceScope, all synthetic/replacement timestamps must stay inside the contractually allowed interval.

Include fixtures with uneven date/time density so a uniform timestamp generator would fail quality checks.

## Reproducibility

Freeze Run inputs and seed. Assert deterministic behavior only to the degree guaranteed by the selected library/runtime versions. Always persist the completed result rather than relying on future recomputation.

## Persistence tests

Test the clean v2 schema from `0001` and normal transactional behavior.

Do not keep fixtures for old encrypted-DB migrations or legacy compatibility; the product has not been distributed.

## Compute integration

Test the actual job boundary:

```text
Electron/application job input
→ job.json + source.parquet
→ packaged/dev Python engine
→ result.parquet + report.json
```

Cover cancellation, malformed input, engine failure, and cleanup of partial output.

## Export

Export the same saved Run to CSV and XLSX and compare the logical table after reading both back.

Include Korean text, commas/quotes/newlines, spreadsheet-formula prefixes, numeric cells, and timestamps.

Default export must not expose provenance fields.

## UI/E2E

Core E2E should eventually cover:

```text
Google/mock login
→ Form selection/import
→ SourceScope
→ final N
→ target
→ generate
→ result
→ CSV/XLSX export
```

Also cover:

- infeasible append-only result
- original replacement approval
- target semantic ambiguity where applicable
- compute cancellation/failure

## Release gate

Before a release candidate:

- lint/typecheck pass
- unit/integration scenario tests pass
- hard Form/target invariants pass
- compute-engine packaged smoke passes
- CSV/XLSX export tests pass
- installed Electron artifact smoke passes

Coverage percentage is secondary to scenario coverage and invariant correctness.
