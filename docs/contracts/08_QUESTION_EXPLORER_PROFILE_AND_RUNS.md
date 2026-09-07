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

## `runs.get` result diagnostics

The Result view must not inspect raw engine validation records or reconstruct historical row provenance in the renderer.

Expose a typed diagnostics object derived from the persisted immutable Run and its persisted rows:

- `sourceResponseCount`: response count in the frozen SourceScope used by the Run
- `syntheticResponseCount`: persisted final rows whose origin is synthetic
- `replacementCount`: frozen source responses that are no longer present as original rows in the final Run
- `structuralValidation`: `passed` when the persisted engine validation contains the required structural-success flags, otherwise `unknown`

For replacement counting, use persisted provenance rather than `finalCount - sourceResponseCount`; replacement Runs can contain additional synthetic rows while also replacing originals.

The renderer may display the frozen `targetSnapshot.sourceScope` together with `sourceResponseCount`, but must not reload the Project's current scope and present it as historical Run evidence.

Raw engine keys remain internal. The Result UI should present these diagnostics as concise supporting text after target outcomes, not as dashboard cards or a generic quality score.

## Non-goals

- no renderer-side denominator reconstruction
- no ordinal targeting by individual score
- no mutation of historical Runs
- no raw engine validation object in user-facing UI
- no generic quality score
