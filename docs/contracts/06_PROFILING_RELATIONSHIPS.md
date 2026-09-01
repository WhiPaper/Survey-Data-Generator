# Profiling, Semantic Inference & Relationship Analysis

## Profiling principle

Observed values may suggest meaning but automatic inference is not a hard business rule.

Store inference and user override separately:

```ts
interface SemanticInference<T> {
  inferred: T
  confidence: number
  evidence: SemanticEvidence[]
}

interface SemanticOverride<T> {
  questionId: QuestionId
  value: T
  updatedAt: string
}
```

Resolved value:

```text
user override if present
otherwise inferred value
```

Updating an inference never silently deletes an override.

## Short-text inference

Candidate semantics:

```text
numeric
categorical
identifier
personal_identifier
formatted_string
free_text
unknown
```

Start with shape statistics:

- answered count
- unique count / ratio
- number-parseable ratio
- mean/median/max length
- whitespace/multiline rate
- digit/alphabetic/alphanumeric rates
- repeated-value rate
- dominant regex-like patterns

Inference uses multiple signals, not a single threshold.

### Numeric

Positive signals:

- high numeric parseability
- meaningful numeric variation
- decimal consistency
- low identifier-pattern evidence

Leading zero, fixed width, sequence-like values and stable prefixes can indicate identifier rather than numeric.

### Categorical

Signals:

- repeated values
- relatively small support
- concentration in top values
- low string-shape variation

Account for sample size; small samples lower confidence.

### Identifier

Signals:

- high uniqueness
- fixed width/prefix/suffix
- leading zeros
- sequence-like structure

Generation uses new unique values preserving format where practical.

### Personal identifier

Examples:

- name
- email
- phone
- personal address-like data

Use value pattern + question title/description + data shape.

Original personal identifiers are not reused by default.

### Formatted string

Examples such as:

```text
EMP-00123
2026-Q1
A-1234
```

where formatting is more meaningful than numeric statistics.

### Free text

Signals:

- high unique ratio
- longer strings
- multi-token text
- variable punctuation/length
- low repeated-value rate

## Question title keywords

A lightweight multilingual keyword dictionary may boost candidate scores but never determines semantics alone.

Example signals:

```text
나이 / 연령 / age
이메일 / email
전화 / 연락처 / phone
사번 / 학번 / id
```

Data shape remains primary.

## Confidence

Do not expose raw confidence as routine UI.

Conceptually:

```text
confidence
≈ top score
× separation from second-best
× sample reliability
```

High confidence: auto-use.

Ambiguous: mark `needsReview`, ask only when the user interacts with the question or before synthesis if required.

Do not force a review wizard for all questions.

## Date inference

```ts
type DateSemanticType =
  | "calendar_date"
  | "birth_date"
  | "annual_date"
  | "date_time"
  | "unknown"
```

- `includeTime=true` strongly supports date_time
- `includeYear=false` supports annual_date
- birth date needs title/context plus realistic historical/age distribution
- title alone is insufficient

Annual dates remain month/day values; do not invent a year.

## Numeric profile

Useful profile includes:

- count
- min/max
- mean/median
- p05/p25/p50/p75/p95
- decimal-place distribution
- optional inferred plausible bounds

Observed min/max are not automatically hard constraints.

Preserve observed precision tendencies.

## Identifier profile

Example:

```ts
interface IdentifierPatternProfile {
  prefix?: string
  suffix?: string
  length?: number
  characterPattern?: string
  numericWidth?: number
  uniquenessRate: number
}
```

Synthetic identifiers must avoid collisions with originals.

## Free-text profile

Base project import computes cheap fields:

- response rate
- length distribution
- PII risk metadata

Topic/sentiment-style analysis is lazy and should occur only when AI mode actually requires it.

Do not copy raw PII into profile JSON/logs.

## Re-profiling after semantic override

A semantic override change may require:

```text
question profile refresh
→ relationship refresh
→ preservation feature refresh
→ target compatibility validation
```

If an existing numeric target becomes incompatible after switching a question to categorical, do not silently delete it; surface a blocking incompatibility.

## Relationship contract

Important distinction:

> The statistic used to **select** a relationship is not necessarily the feature used to **preserve** it.

```ts
interface RelationshipProfile {
  family: RelationshipFamily
  method: string
  supportCount: number

  strength: number
  signedStrength?: number

  reliability: number
  selectionScore: number

  preserveRecommended: boolean
  preservationFeatures: PreservationFeatureSpec[]
}
```

P-values are optional diagnostics, not the primary ranking signal.

### Candidate measures

- categorical × categorical — Cramér's V; Phi for binary/binary
- ordinal × ordinal — Spearman
- numeric × numeric — Pearson + Spearman; use meaningful stronger signal
- categorical × numeric — eta / correlation ratio
- categorical × ordinal — rank-based eta or compact joint distribution
- ordinal × numeric — Spearman
- binary × numeric — point-biserial
- checkbox option × option — Phi plus joint rate/lift
- temporal variables — derived weekday/month/time-bin/interval measures

Use answered×answered support for pair analysis.

Do not treat skipped/not_reached as ordinary categories.

Missingness relationships are modeled separately.

Indeterminate rows reduce reliability.

### Preservation features

- small categorical/ordinal tables — preserve joint cells
- large tables — keep selected interaction cells
- numeric — standardized/rank product style features
- checkbox — marginals + selection-count distribution + important co-occurrence
- grids — semantic boost for related rows; compact grids may preserve all internal row relationships
- date pairs — interval/order features where meaningful

Do not generate every possible pair/cell.

Selection score follows effect size × reliability × semantic boost.

Detailed-goal relationships and confirmed grid structure may bypass ordinary caps.
