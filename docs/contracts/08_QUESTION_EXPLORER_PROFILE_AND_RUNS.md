# Question Explorer public data contract

This slice closes renderer gaps without moving authoritative metric logic into the UI.

## `targets.profile`

The profile response should expose enough current-state evidence for the Question Explorer to render values without reconstructing denominators or response subsets.

### Ordinal distribution

For each ordinal question, expose the answered-response denominator and a stable per-score distribution covering every integer score in the Form-defined range, including zero-observation scores.

The renderer may visualize this distribution, but it must not derive it from raw response rows.

### Conditional share baseline

For each valid `ValueGroup` × checkbox-option combination, expose:

- numerator count
- eligible denominator count
- share

The denominator is the eligible checkbox population inside the selected ValueGroup under the active `SourceScope`. The renderer must not substitute ValueGroup size for this denominator.

## `runs.list`

Expose project-scoped persisted Run summaries ordered newest first. A summary should be sufficient for a Result selector without loading every full Run payload and should include at least:

- Run id
- project id
- source revision id
- created-at timestamp
- final response count

Selecting one summary continues to use `runs.get` for the immutable historical payload.

## Non-goals

- no renderer-side denominator reconstruction
- no ordinal targeting by individual score
- no mutation of historical Runs
- no source refresh/apply lifecycle in this slice
