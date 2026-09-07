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

## `runs.get` historical target baselines

The Result grammar is `current → intent/goal → result`. For a persisted historical Run, `current` must mean the baseline at the time that Run was created, not the Project's current draft or current source revision.

`runs.get` therefore exposes one typed baseline entry per frozen Run target. Baselines are computed from immutable Run evidence only:

- the Run's persisted `sourceRevisionId`
- the Run's frozen SourceScope
- the source responses belonging to that historical revision/scope
- frozen ValueGroup definitions embedded in the Run target snapshot

Baseline semantics must match `targets.profile`:

- count target: current count
- share target: current numerator count, eligible denominator count, and share
- mean target: current mean and answered denominator
- conditional share target: current numerator count, eligible checkbox denominator inside the frozen ValueGroup population, and share

The backend is authoritative for these values. The renderer must not rebuild historical denominators, reuse the Project's current `targets.profile`, or substitute current ValueGroup definitions for the frozen ValueGroup snapshot.

Historical baseline computation must remain valid after source refreshes, ValueGroup edits/deletions, draft changes, and app restarts because the Run points at immutable source evidence and freezes the target/group definition it used.

## `runs.get` historical target presentation

A historical Result must also keep the user-facing target identity that belonged to the Run's source revision. The renderer must not look up a historical target's question or option label from the Project's current Form snapshot.

`runs.get` therefore exposes one presentation entry per frozen Run target. Each entry contains:

- `targetId`: stable join key to the frozen target, baseline, and outcome
- `questionId`: historical target question id used for optional navigation back to setup
- `questionTitle`: title from the Form snapshot referenced by the Run's source revision
- `subjectLabel`: historical option label, frozen ValueGroup name, or the historical question title for a mean target
- `populationLabel`: frozen ValueGroup name for a conditional-share population, otherwise omitted

These strings are derived when `runs.get` is read from the immutable Form snapshot associated with the Run's persisted source revision plus the frozen target snapshot. They do not require a Run-table migration and do not mutate the historical Run.

The current Project Form may be consulted only to decide whether navigating back to a question is still possible. It must not change the label rendered for a historical Result.

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
- no renderer-side historical Form label lookup
- no ordinal targeting by individual score
- no mutation of historical Runs
- no raw engine validation object in user-facing UI
- no generic quality score
