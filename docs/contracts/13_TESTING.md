# Testing & Quality Gate Contract

## Test layers

```text
1. Domain unit tests
2. Profiler / inference tests
3. Solver / synthesis tests
4. Property-based tests
5. Integration tests
6. UI / E2E tests
```

## Global synthesis invariants

Every valid run must satisfy:

```text
original row mutations = 0

final row count
=
source row count + synthetic row count

all synthetic rows
→ supported hard Form rules pass

exact user targets
→ exact

range targets
→ within range

approx ratio/mean
→ nearest feasible representation

confirmed branch contradictions
→ 0

confirmed required-question violations
→ 0
```

## Original immutability

Hash/freeze source rows before synthesis and compare after.

Also verify export does not “normalize” original free text/categorical values.

## Seed reproducibility

Same:

- source revision
- target snapshot
- seed
- engine version

must produce identical structured synthetic rows.

Different seeds are tested only in fixtures with enough feasible freedom; require some variation while keeping all hard constraints satisfied.

## Exact/approx semantics

Exact count uses tolerance zero.

Percentage/mean tests calculate mathematically representable results rather than using arbitrary fixed epsilon.

## Feasibility tests

Examples:

- source N > target final N
- immutable original category contribution exceeds target count
- conflicting single-choice category counts
- conflicting conditional/global targets
- impossible ordinal mean bound

Ensure infeasibility is detected before the expensive synthesis path where possible.

## Form logic fixtures

At least:

```text
no branching
yes/no to different sections
option → submit
next section
nested branch
restart flow
optional-only section
branch with required question
```

Snapshot-test PathResolver evidence.

Explicitly test:

```text
answered
skipped
not_reached
indeterminate
```

## Structural mutation

Test:

- branch change repairs newly reached/unreached answers
- donor requirements
- no donor → mutation denied
- restart/ambiguous path → structural mutation denied
- PII/free-text/file/timestamp not donor-copied

## Profiler golden fixtures

Examples:

```text
single-choice-balanced
checkbox-correlated
ordinal-skewed
numeric-outliers
short-text-identifiers
short-text-categorical
short-text-free-text
birth-dates
branching-missingness
```

Semantic inference tests should assert class and a confidence range, not brittle exact confidence decimals.

## Relationship tests

Build synthetic fixtures for known expected relationships:

- independent categorical variables → Cramér's V near zero
- strongly linked categorical variables → high V
- monotonic ordinal → high |Spearman|
- linear numeric → high Pearson
- nonlinear monotonic numeric → Spearman stronger than Pearson where expected

Ensure relationship caps work but explicit detailed-goal relationships are not dropped by ordinary automatic caps.

## Checkbox

Verify:

- option marginals
- selection-count distribution
- important co-occurrence

## Property-based testing

Use `fast-check` or equivalent.

Separate generators:

```text
arbitraryFeasibleTargets
arbitraryPossiblyInfeasibleTargets
```

Feasible generator tests successful synthesis invariants.

Possibly-infeasible generator tests that FeasibilityChecker never crashes and produces coherent status/issues.

## Metamorphic tests

Examples:

- target N increase with no explicit user targets should preserve source statistics within benchmark tolerances
- adding one explicit marginal should move that metric while minimizing unrelated degradation

## Regression benchmarks

Internal-only quality metrics may include:

```text
marginalError
relationshipError
temporalError
duplicateRatio
```

These are CI/engineering metrics, not a user-facing “preservation score”.

Representative benchmark sizes:

```text
Tiny   20 rows / 8 questions
Small  50 / 20
Medium 500 / 40
Large  10,000 / 60
```

Include mixed question kinds, grids, branching and missingness.

Track relative performance regression rather than premature hard wall-clock SLAs.

Track peak memory/RSS where practical.

## Cancellation & transactions

Test:

- cancel long job
- no partial run
- worker recovers for next job
- persistence failure rolls back
- previous project/run remains intact

## DB migrations

Keep fixtures from historical schema versions.

Test sequential migration to latest while preserving:

- projects
- source revisions
- targets
- runs

Do not silently create a fresh DB on migration failure.

## RPC

Test:

- valid request
- invalid params
- unknown method
- protocol version mismatch
- JSON split across stream chunks
- multiple NDJSON messages in one chunk
- stderr logging does not pollute stdout protocol
- sidecar unexpected exit

## Export

For one Run, export both CSV and XLSX, read them back, compare logical table:

- rows
- columns
- headers
- values
- ordering

CSV fixtures include:

- comma
- quote
- newline
- Korean
- emoji
- formula-prefix values

XLSX checks:

- numeric cells are numeric
- date/time typed cells
- duration type/format
- response text not formulas
- freeze/header/filter contract

Default export must not contain provenance fields.

## AI

CI uses a fake LLM gateway.

Test:

- success
- malformed output
- PII output
- source-copy output
- rate limit
- timeout
- credential error
- partial failure

Invariant for partial failure:

```text
structured rows intact
row count intact
failed text blank
warning recorded
```

AI OFF must result in zero LLM network calls.

## UI/E2E

Key target-editor tests:

- entering female 55% creates only female ratio constraint
- auto-derived male is not a user constraint
- reset removes constraint
- unit display toggle preserves ratio semantic
- editing count converts target semantic to count

Core E2E:

```text
mock Google login
→ Form list
→ Form selection
→ project creation
→ target N
→ female %
→ ordinal mean
→ synthesize
→ result
→ XLSX export
```

Representative failure E2E:

- reauth required
- zero responses
- infeasible target
- no donor support
- sidecar crash
- export save failure

## Release gate

Required:

```text
all domain/unit tests pass
property tests pass
hard constraint fixtures pass
confirmed Form logic violations = 0
original mutations = 0
export contract tests pass
DB migration tests pass
core E2E pass
packaged-install smoke tests pass
```

Coverage percentage is secondary to invariants and regression benchmarks.
