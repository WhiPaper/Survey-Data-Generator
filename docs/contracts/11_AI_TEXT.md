# Optional AI Free-Text Contract

## Product position

AI free-text generation is optional and off by default.

The entire product must work without any LLM.

Default free-text strategy:

```ts
{ mode: "blank" }
```

Do not block v1 core release on AI.

## Strategies

```ts
type FreeTextStrategy =
  | { mode: "blank" }
  | { mode: "reuse" }
  | { mode: "phrase_pool" }
  | AiFreeTextStrategy
  | { mode: "exclude" }
```

AI settings may include:

- response rate: preserve or target
- length: preserve or range
- topics: preserve or custom
- selected structured context question IDs

The normal editor exposes only the minimum. Advanced controls live in a Sheet.

## Generation order

```text
Structured synthesis finalized
→ choose which synthetic rows should answer
→ select safe structured context
→ PII reduction/redaction
→ prompt building
→ batched LLM generation
→ validation
→ limited retry
→ persist accepted text or blank fallback
```

The LLM generates content only; it does not choose which rows are eligible or whether they answer.

## Answered rows

Preserve free-text response-rate patterns by determining `shouldAnswer` before calling the LLM.

If strong relationships exist, e.g. dissatisfied users answer comments more often, the structured engine may preserve that relationship.

Do not call the provider for rows that will remain blank.

## Context minimization

Do not send the entire row/dataset.

Context selector prioritizes:

1. explicit user-selected context questions
2. strongly related structured questions
3. semantically relevant fields
4. omit everything else

Default exclusions:

- personal_identifier
- identifier
- file
- other unnecessary personal fields

## Original free-text examples

Do not send the entire corpus.

If examples are useful:

```text
original free text
→ PII detector
→ redactor
→ small representative sample
→ prompt examples
```

Prefer aggregate profile information (length/topic structure) over raw examples when sufficient.

## PII

Run PII checks:

1. before sending original examples/context
2. on generated output

Do not log raw prompts/provider outputs by default.

Profile stores PII category/risk metadata, not copied raw identifiers.

## Original-text copying

`reuse` mode explicitly permits using source text.

`ai` mode does not.

AI mode must guard against copying originals via at least:

- normalized exact-match detection
- long substring overlap
- n-gram similarity

Embedding-based validation is not required for v1.

## No evasion features

Do not implement:

- “AI 티 안 나게”
- AI detector evasion
- deliberately inserted typos to mimic humans
- “humanize” controls intended to defeat detection

The goal is coherent synthetic data, not concealment.

## Provider abstraction

Keep a minimal gateway:

```ts
interface LlmGateway {
  generateText(
    request: LlmGenerationRequest,
    signal?: AbortSignal
  ): Promise<LlmGenerationResponse>
}
```

Implement one actual provider in v1. Do not prebuild a large provider plugin system.

Credentials are stored in `SecureSecretStore`, never React or SQLite project JSON.

Google account switching does not implicitly switch the LLM credential.

## Batching

Use adaptive batches within provider limits.

Each item has a stable request ID; never rely only on response-array ordering.

Concurrency is globally limited in the sidecar.

## Validation

Generated output pipeline:

```text
schema
→ length
→ PII
→ contradiction
→ similarity
```

v1 contradiction validation should be conservative and cheap, focusing on obvious conflicts with selected structured fields.

Do not double provider cost with an LLM judge for every row unless later justified.

## Retry

Limit attempts, e.g. two attempts per item.

No infinite retry.

Partial item failure:

```text
structured row remains valid
free-text cell → blank
warning recorded
```

Provider-wide credential/unavailable errors may fail the AI stage in a recoverable way.

A result can support retrying only failed text items without rerunning structured synthesis.

## Reproducibility

External model output is not assumed perfectly reproducible.

Therefore store accepted generated text in the Run.

Re-export never calls the LLM.

Internal metadata may store:

- provider
- model
- generatedAt
- attemptCount
- promptTemplateVersion
- generation settings hash

Do not store full prompt/raw response by default.

## Public-release gate

Because Google-originated user data may be transmitted to a third-party LLM, the AI feature must remain disabled in a public production build until current Google OAuth verification / Limited Use / third-party transfer requirements have been reviewed and the implemented data flow is permitted and correctly disclosed.

When first enabling AI, the user receives a concise one-time consequence notice:

```text
선택한 설문 정보가 AI 서비스로 전송됩니다.
```

Actual data transfer must remain minimal.
