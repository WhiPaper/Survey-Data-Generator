import type { QuestionId, ResponseId, RunId } from "@survey-synth/domain";
import type { AiMetadata } from "@survey-synth/contracts";

export type { AiMetadata } from "@survey-synth/contracts";

export interface StructuredContextField {
  readonly title: string;
  readonly answer: string;
}

export interface LlmBatchItem {
  readonly id: string;
  readonly questionTitle: string;
  readonly questionDescription?: string;
  readonly structuredContext: readonly StructuredContextField[];
  readonly sourceExamples: readonly string[];
}

export interface LlmGenerationRequest {
  readonly items: readonly LlmBatchItem[];
  readonly promptVersion: number;
  readonly model: string;
}

export interface LlmGenerationResponseItem {
  readonly id: string;
  readonly text: string;
}

export interface LlmGenerationResponse {
  readonly items: readonly LlmGenerationResponseItem[];
}

export interface AiEligibleCell {
  readonly responseId: ResponseId;
  readonly questionId: QuestionId;
  readonly questionTitle: string;
  readonly questionDescription?: string;
  readonly structuredContext: readonly StructuredContextField[];
  readonly sourceExamples: readonly string[];
}

export interface AiGenerationResult {
  readonly status: "completed" | "partial" | "skipped";
  readonly runId: RunId;
  readonly generatedFieldCount: number;
  readonly totalEligibleFieldCount: number;
  readonly warnings: readonly string[];
  readonly metadata?: AiMetadata;
}
