import { createHash } from "node:crypto";
import { AI_GENERATION_POLICY_V1 } from "./policy.js";
import type { LlmBatchItem } from "./types.js";

export const buildSystemPrompt = (): string =>
  `You are an AI assistant generating natural survey free-text responses for synthetic respondents.
Follow these strict instructions:
1. Generate natural, plausible, and realistic response text for each requested question.
2. Align the tone and content with the respondent's other structured answers if provided (e.g. satisfaction score, demographic choices).
3. Do NOT include any personally identifiable information (PII) such as real names, emails, phone numbers, addresses, or identification numbers.
4. Do NOT copy the provided source examples verbatim or make slight paraphrases. Provide fresh, diverse phrasing.
5. Return your response ONLY as a JSON object matching this schema:
{"items": [{"id": "exact_item_id", "text": "generated free-text response"}]}
Ensure every item ID from the request is included.`;

export const buildUserPrompt = (items: readonly LlmBatchItem[]): string => {
  const formattedItems = items.map((item) => {
    const lines = [`Item ID: ${item.id}`, `Question: ${item.questionTitle}`];
    if (item.questionDescription && item.questionDescription.trim() !== "") {
      lines.push(`Description: ${item.questionDescription.trim()}`);
    }
    if (item.structuredContext.length > 0) {
      const contextStr = item.structuredContext.map((c) => `${c.title}: ${c.answer}`).join("; ");
      lines.push(`Respondent structured profile: ${contextStr}`);
    }
    if (item.sourceExamples.length > 0) {
      const examplesStr = item.sourceExamples.map((ex, i) => `(${i + 1}) "${ex}"`).join(" ");
      lines.push(`Reference examples of original style (DO NOT COPY): ${examplesStr}`);
    }
    return lines.join("\n");
  });

  return `Generate synthetic responses for the following ${items.length} survey items:\n\n${formattedItems.join("\n---\n")}`;
};

export const computeSettingsHash = (settings: {
  provider: string;
  model: string;
  promptVersion: number;
  batchSize?: number;
  minTextLength?: number;
  maxTextLength?: number;
}): string => {
  const normalized = {
    provider: settings.provider,
    model: settings.model,
    promptVersion: settings.promptVersion,
    batchSize: settings.batchSize ?? AI_GENERATION_POLICY_V1.batchSize,
    minTextLength: settings.minTextLength ?? AI_GENERATION_POLICY_V1.minTextLength,
    maxTextLength: settings.maxTextLength ?? AI_GENERATION_POLICY_V1.maxTextLength,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
};

