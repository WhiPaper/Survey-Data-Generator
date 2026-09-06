# Google Form Logic & Structural Validity

Google Forms responses do not expose complete path history. Preserve evidence and uncertainty rather than inventing routing.

## Internal reachability state

For each question keep:

```text
reached
not_reached
indeterminate
```

Combined with answer presence this yields the domain answer states `answered`, `skipped`, `not_reached`, and `indeterminate`.

Evidence rules remain conservative:

- an existing answer proves the question was reached
- an answered question in a section proves that section was reached
- a confirmed branch may prove downstream sections were not reached
- an optional absent answer in an otherwise unproven section remains indeterminate

Unknown routing is never turned into a confident path merely to make generation easier.

## Candidate generation boundary

The v2 engine does not mutate an observed row cell-by-cell and then repair the branch.

Instead, candidate rows are generated as complete records and validated against the Form logic before final selection.

A small internal path/structural feature such as `__path_id` may be used when useful, but it is an implementation detail rather than a public domain hierarchy.

When the generation library supports categorical-combination constraints, prefer those over a custom donor/repair engine.

## Hard validation

A final row is invalid when evidence proves a contradiction, including:

- an answer exists in a confirmed not-reached question
- a confirmed reached required question is blank
- a value is outside the Form's allowed structured domain
- a confirmed branch contradicts downstream answers

Ambiguous routing is validation uncertainty, not automatically a hard failure.

## Original replacement

If an approved EditPlan replaces an original-derived row, the replacement is a complete structurally valid candidate row. Do not implement branch-specific cell mutation/donor repair in v2.

Imported source observations remain unchanged.

## Unsupported / restart behavior

If the Form's routing cannot be represented confidently, prefer observed structural patterns and reject unsafe candidates. Do not invent restart histories or unsupported navigation behavior.
