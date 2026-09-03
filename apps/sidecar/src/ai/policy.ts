export const AI_GENERATION_POLICY_V1 = Object.freeze({
  /** Authoritative single provider identifier for v1 */
  provider: "openai" as const,
  /** Stable default model identifier */
  defaultModel: "gpt-4o-mini",
  /** Stable prompt template version */
  promptVersion: 1,
  /** Number of items bundled in a single LLM request */
  batchSize: 10,
  /** Maximum concurrent LLM requests */
  maxConcurrency: 2,
  /** Maximum retry attempts per item upon transient failure or similarity rejection (1 initial + 2 retries = 3 attempts) */
  maxRetriesPerItem: 2,
  /** Maximum number of source examples provided per prompt */
  maxSourceExamples: 3,
  /** Minimum character length for valid generated text */
  minTextLength: 2,
  /** Maximum character length for valid generated text */
  maxTextLength: 1000,
  /** Minimum character length of identical substring between source and generated text to trigger similarity rejection */
  minSubstringMatchChars: 20,
  /** Tri-gram / bigram Jaccard similarity threshold above which generated text is rejected as too similar to source */
  maxNgramSimilarity: 0.65,
  /** Request timeout in milliseconds */
  requestTimeoutMs: 30_000,
});
