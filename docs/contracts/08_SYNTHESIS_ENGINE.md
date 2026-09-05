# Synthesis Engine Contract

## Goal

Generate a plausible candidate pool from the selected source data, then select rows that satisfy the user's final-dataset targets. Keep application-owned synthesis code thin.

## Canonical v2 flow

```text
prepare source scope
→ fit/sample candidate rows with SDV
→ hard-validate candidate structure
→ compile candidate features and targets
→ select rows with scipy.optimize.milp
→ if append-only infeasible, solve minimal original replacement plan
→ evaluate with hard validators + SDMetrics
→ write result
```

There is no weighted-resampling/mutation/global-repair pipeline in v2.

## Candidate generation

Initial implementation uses SDV `GaussianCopulaSynthesizer` unless benchmark results justify a different model.

Candidate generation should include structured answers and response timestamp together where supported so ordinary correlations are learned jointly.

Generate a pool larger than the requested synthetic row count. If the solver lacks support for a valid target, regenerate/enrich the pool before adding custom mutation logic.

Empirical rows may be used as fallback/support but final output must avoid obvious copy artifacts.

## Form structure

Prefer library-supported metadata/constraints plus the existing conservative Form reachability validator.

Complete candidates that violate confirmed routing, required fields, or allowed value domains are rejected.

Do not implement donor-based structural mutation in v2.

## Selection

Use `scipy.optimize.milp` for integer candidate selection.

Typical variable:

```text
x_j ∈ {0,1}
```

where `x_j` selects candidate row `j`.

The same formulation is used for target feasibility and final selection. Avoid CVXPY and a direct HiGHS wrapper unless SciPy proves insufficient for a concrete scenario.

## Append-only mode

Source-derived rows are fixed in the final dataset. MILP chooses only the requested synthetic additions.

## Replacement mode

If append-only is infeasible, introduce source-row keep/replace decisions and minimize the number of replaced source-derived rows.

Replacement candidates are complete generated rows. The result is returned as an `EditPlan` and is not committed until the user approves it.

Imported source observations are never modified.

## Timestamp

Timestamp is part of the generated row.

Default behavior relies on SDV datetime modeling before adding a custom temporal subsystem.

Hard checks:

- valid timestamp
- respects frozen time scope when applicable

Quality checks compare synthetic/final temporal behavior with the source scope. Add custom burst/inter-arrival generation only if benchmark evidence shows material failure.

## Short text

Low-cardinality repeated short text may be modeled categorically.

High-cardinality free text is not newly authored by v2. Use blank/reuse/observed-value strategies as required by product behavior. ValueGroup targets operate on derived membership features, not on semantic generation.

## Quality

Use SDMetrics for general tabular fidelity diagnostics where appropriate.

Survey Synth hard validators separately verify:

- final row count
- target achievement
- Form/routing validity
- allowed values
- frozen SourceScope
- approved replacement plan

Exact duplicate/concentration checks may be simple dataframe diagnostics. Do not create a separate diversity subsystem without demonstrated need.

## Reproducibility

Freeze source scope, target snapshot, ValueGroup snapshot, seed, engine version, and approved EditPlan in the Run.

Use deterministic seeds for libraries where supported. Reproducibility requirements should reflect the actual guarantees of chosen third-party libraries rather than pretending external algorithms are perfectly deterministic across versions/platforms.

## Custom-code gate

Do not add a new synthesis subsystem unless a representative scenario/benchmark demonstrates that SDV + SciPy MILP + hard validation + SDMetrics cannot meet the product requirement.
