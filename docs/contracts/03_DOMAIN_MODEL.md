# Domain Model Contract

The domain package is pure TypeScript and has no React, Tauri, Google, SQLite or solver dependency.

## Branded IDs

```ts
type Brand<T, B extends string> = T & { readonly __brand: B }

type FormId = Brand<string, "FormId">
type SectionId = Brand<string, "SectionId">
type QuestionId = Brand<string, "QuestionId">
type GroupId = Brand<string, "GroupId">
type OptionKey = Brand<string, "OptionKey">
type ResponseId = Brand<string, "ResponseId">
type ProjectId = Brand<string, "ProjectId">
type RunId = Brand<string, "RunId">
type GoogleAccountId = Brand<string, "GoogleAccountId">
type SourceRevisionId = Brand<string, "SourceRevisionId">
```

## Form snapshot

A project uses an immutable local Form snapshot with a local `schemaHash`.

Do not treat a Google Forms revision field as the permanent project version.

A normalized Form contains:

- `formId`
- title/description
- capturedAt
- schemaHash
- sections
- questions
- groups
- logic

## Question model

Normalize to domain types:

```text
SingleChoiceQuestion
MultiChoiceQuestion
OrdinalQuestion
TextQuestion
DateQuestion
TimeQuestion
FileQuestion
UnsupportedQuestion
```

### Single choice

Radio and dropdown share one engine:

```ts
presentation: "radio" | "dropdown"
```

Options have app-generated stable `OptionKey`.

Option value and branch destination are separate data.

### Multi-choice / checkbox

Preserve option marginals, selection-count behavior and important co-occurrence.

### Ordinal

Linear scale and rating share one ordinal engine:

```ts
presentation:
  | "linear_scale"
  | "rating_star"
  | "rating_heart"
  | "rating_thumb_up"
```

Do not assume high score means positive sentiment.

### Text

```ts
type ShortTextSemanticType =
  | "numeric"
  | "categorical"
  | "identifier"
  | "personal_identifier"
  | "formatted_string"
  | "free_text"
  | "unknown"
```

Semantic inference is advisory and may be overridden.

### Grid

Do not create a special solver row type.

Each grid row remains a normal SingleChoice/MultiChoice question with `groupId`.

`QuestionGroup` owns shared title, columns and presentation.

The UI treats a grid group as one adjustable item.

## Answer state

This distinction is mandatory:

```ts
type AnswerSlot =
  | { state: "answered"; value: AnswerValue }
  | { state: "skipped" }
  | { state: "not_reached" }
  | { state: "indeterminate" }
```

Meaning:

- `answered` — value exists.
- `skipped` — confirmed reached, optional/unanswered.
- `not_reached` — evidence proves the question could not have been reached.
- `indeterminate` — value absent and the API evidence cannot prove skipped vs not reached.

Never collapse these states in analysis.

General exports may render all absence states as blank cells, but internal analysis keeps them distinct.

## NormalizedResponse

Internal response model includes:

- responseId
- createdAt
- lastSubmittedAt
- `answers: Record<QuestionId, AnswerSlot>`
- internal `origin: "original" | "synthetic"`
- optional templateResponseId for synthetic rows

Origin is required internally but excluded from default CSV/XLSX.

## Profile base

```ts
interface ProfileBase {
  questionId: QuestionId

  answeredCount: number
  skippedCount: number
  notReachedCount: number
  indeterminateCount: number

  confirmedEligibleCount: number // answered + skipped
  responseRate: number // answered / (answered + skipped)
}
```

Indeterminate is excluded from the confirmed-eligible denominator and reduces reliability.

## Project targets

```ts
interface ProjectTargets {
  targetResponseCount: number

  questions: Partial<Record<QuestionId, QuestionTarget>>
  groups: Partial<Record<GroupId, GroupTarget>>

  detailedGoals: ConditionalGoal[]

  timestamp?: TimestampTarget
  advanced?: AdvancedProjectTargets
}
```

Unmentioned fields are preserved automatically.

## AllocationConstraint

```text
auto
ratio
count
ratio_range
count_range
```

`count` is exact/hard.

A ratio is a target percentage and is realized at the nearest representable integer result.

## Free text strategy

```ts
type FreeTextStrategy =
  | { mode: "blank" }
  | { mode: "reuse" }
  | { mode: "phrase_pool"; /* ... */ }
  | { mode: "ai"; /* ... */ }
  | { mode: "exclude" }
```

Default: `blank`.

## Project/run

A synthesis run freezes:

- source revision
- target revision
- target snapshot
- seed
- engine version
- profiler version
- app version
- optional AI metadata

Past runs are not silently reprocessed when algorithms change.
