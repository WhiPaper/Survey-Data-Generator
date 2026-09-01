# Google Form Logic & Reachability Contract

Google Forms response data does not expose a complete user path history. The engine must preserve evidence and uncertainty rather than invent routing.

## Logic representation

```ts
interface FormLogic {
  entrySectionId: SectionId
  sections: SectionNode[]
  transitions: LogicTransition[]
  coverage: "none" | "partial"
  hasRestartFlow: boolean
}

interface SectionNode {
  id: SectionId
  order: number
  questionIds: QuestionId[]
  nextSectionId?: SectionId
}

interface LogicTransition {
  sourceQuestionId: QuestionId
  optionKey: OptionKey
  destination:
    | { type: "next_section" }
    | { type: "section"; sectionId: SectionId }
    | { type: "submit" }
    | { type: "restart" }

  evidence: "api_confirmed"
}
```

`nextSectionId` represents document sequence, not proof that the submitted response actually followed that route.

Single-choice questions with navigation are marked:

```ts
affectsNavigation: true
```

Checkbox/grid options are not treated as navigation drivers unless the source API actually supports and confirms such behavior.

## Path resolution

```ts
interface PathResolution {
  questions: Record<
    QuestionId,
    "reached" | "not_reached" | "indeterminate"
  >

  confidence:
    | "certain"
    | "partial"
    | "ambiguous"
}
```

Evidence rules:

- an existing answer proves the question was reached
- any answered question in a section proves that section was reached
- an absent optional question in a confirmed reached section is `skipped`
- a submitted response missing a required question can establish `not_reached` when the question would otherwise have required an answer
- an API-confirmed branch may prove downstream sections were not reached
- an optional absent question in an otherwise unproven section is `indeterminate`

`indeterminate` is not a convenience synonym for missing.

## RESTART_FORM

The API may expose restart navigation but submitted responses do not reveal loop count/history.

v1 policy:

- rows involving restart may remain ambiguous
- do not structurally mutate an existing row into/out of a restart path
- resampling observed patterns is allowed
- do not invent loop history

## Structural mutation

Changing a branch-driving answer is never a local single-cell edit.

Process:

```text
change branch value
→ recompute reachability evidence
→ clear newly unreachable answers → not_reached
→ detect newly reached area
→ select donor support
→ initialize required structured answers
→ validate
```

```ts
interface StructuralMutationPolicy {
  canMutate(
    response: NormalizedResponse,
    questionId: QuestionId,
    nextValue: AnswerValue
  ):
    | {
        allowed: true
        impact: StructuralImpact
      }
    | {
        allowed: false
        reason:
          | "logic_ambiguous"
          | "restart_flow"
          | "no_donor_support"
          | "unsupported_navigation"
      }
}
```

Unsafe mutation candidates do not enter global repair.

## Donors

Hard donor pool requirements:

- target section is confirmed reached
- required target-section questions are answered
- compatible branch
- prefer excluding indeterminate donor rows

Similarity uses mixed distance:

- categorical 0/1
- ordinal normalized absolute distance
- numeric percentile distance
- checkbox Jaccard
- time circular distance

Compare mainly:

- pre-branch stable answers
- strong relationship neighbors
- detailed-goal-related stable fields

Choose from top-K near donors using distance-weighted seeded sampling rather than always taking the nearest row.

Never automatically donor-copy:

- personal identifiers
- identifiers
- free text
- files
- timestamps

## Structural features

Feature space contains explicit structural indicators such as:

```text
question:Q:reached
question:Q:answered
question:Q:skipped
```

Structural mutation updates these deltas.

For source rows with indeterminate reachability:

- preserve/resample the observed absence pattern
- avoid structural mutation affecting the ambiguous region
- do not invent new uncertainty

## Validation

Hard failures only when evidence proves a violation, e.g.:

- answer exists in confirmed not-reached question
- confirmed reached required question is blank
- invalid option
- confirmed branch contradicts downstream answer

Unknown routing is validation uncertainty, not an automatic hard failure.
