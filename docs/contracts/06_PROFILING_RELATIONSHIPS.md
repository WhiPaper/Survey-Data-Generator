# Derived Features, ValueGroups & Quality Boundaries

This document replaces the old semantic-inference/relationship-analysis architecture. v2 does not require a custom profiler or relationship engine as a synthesis prerequisite.

## Prepared data

Preparation converts normalized survey rows into the tabular representation needed by the compute engine while preserving raw values for export.

Typical derived columns:

```text
__answered_<question>
__reached_<question>
__option_<question>_<option>
__score_<question>
__valuegroup_<groupId>
__path_id (when useful)
```

Keep derived columns internal.

## ValueGroup

A `ValueGroup` is explicitly user-defined.

Example:

```text
과일 = {사과, 오렌지, 귤}
```

The application may normalize trivial formatting for search/display, but must not claim that arbitrary concepts are automatically understood.

Groups may overlap. A raw value can contribute to multiple boolean features.

If new raw values arrive after a source refresh, they are not silently added to an existing group.

## Short text

Use simple data shape to choose treatment:

- low-cardinality repeated text may be treated as categorical for candidate generation
- high-cardinality free text is not generatively synthesized in v2

For targeted high-cardinality text, use ValueGroup membership as the optimization feature and render/generate only from observed or explicitly user-provided values.

No LLM, embedding classifier, topic model, or semantic taxonomy is required.

## Numeric/date parsing

Use deterministic parsing only. Unparseable values remain unparsed and may be reviewed/mapped by the user if a target requires them.

Do not implement broad natural-language interpretation merely to classify a value.

## Relationship preservation

Do not compute and preserve a custom catalog of Pearson/Spearman/Cramér's V relationships as part of the core pipeline.

The candidate generator is responsible for learning ordinary joint tabular structure. SDMetrics is responsible for general post-generation quality comparison.

Add a custom relationship metric only after a scenario demonstrates that the dependency-backed approach fails a product requirement.

## Timestamp

Treat the response timestamp as part of the row. Prefer generation through the tabular model's datetime support before introducing a custom temporal model.

Hard rules:

- timestamp must be valid
- timestamp must respect the frozen SourceScope boundary when the scope constrains time

Quality checks may compare datetime shape and pair trends. A custom inter-arrival/burst model is deferred until benchmark evidence requires it.

## Diversity

Do not create a dedicated diversity optimizer initially.

At evaluation time inspect at least:

- exact duplicate rows/fingerprints excluding provenance
- concentration of repeated answer patterns when useful
- SDMetrics new-row/general quality diagnostics where supported

If exact candidate duplicates create obvious artifacts, regenerate a larger candidate pool before inventing a new optimization subsystem.

## Quality ownership

General synthetic quality:

```text
SDMetrics
```

Survey Synth hard correctness:

```text
final N
target achievement
Form/routing validity
allowed values
SourceScope
approved EditPlan only
```

Do not hide these dimensions inside one user-facing quality number.
