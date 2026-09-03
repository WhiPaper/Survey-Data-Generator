import { sidecarError } from "../errors.js";
import { AI_GENERATION_POLICY_V1 } from "./policy.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import type { LlmGenerationRequest, LlmGenerationResponse } from "./types.js";

const OPENAI_API_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export interface LlmGateway {
  generateText(
    request: LlmGenerationRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<LlmGenerationResponse>;
}

export interface OpenAiLlmGatewayOptions {
  readonly fetchImpl?: typeof fetch;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

export class OpenAiLlmGateway implements LlmGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options?: OpenAiLlmGatewayOptions) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.endpoint = options?.endpoint ?? OPENAI_API_ENDPOINT;
    this.timeoutMs = options?.timeoutMs ?? AI_GENERATION_POLICY_V1.requestTimeoutMs;
  }

  async generateText(
    request: LlmGenerationRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<LlmGenerationResponse> {
    if (!apiKey || apiKey.trim() === "") {
      throw sidecarError("BACKEND_UNAVAILABLE", "OpenAI API key is missing or empty", false, {
        reason: "ai_credential_missing",
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(request.items) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
        signal: combinedSignal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw sidecarError(
            "BACKEND_UNAVAILABLE",
            "OpenAI API key is invalid or unauthorized",
            false,
            { reason: "ai_credential_invalid", status: response.status },
          );
        }
        if (response.status === 429) {
          throw sidecarError("RATE_LIMITED", "OpenAI API rate limit exceeded", true, {
            status: 429,
          });
        }
        if (response.status >= 500) {
          throw sidecarError(
            "BACKEND_UNAVAILABLE",
            `OpenAI API server error (${response.status})`,
            true,
            { status: response.status },
          );
        }
        throw sidecarError(
          "VALIDATION_FAILED",
          `OpenAI API request failed with status ${response.status}`,
          false,
          { status: response.status },
        );
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw sidecarError(
          "VALIDATION_FAILED",
          "OpenAI API returned an empty or malformed completion",
          true,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw sidecarError(
          "VALIDATION_FAILED",
          "OpenAI API response content is not valid JSON",
          true,
        );
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("items" in parsed) ||
        !Array.isArray(parsed.items)
      ) {
        throw sidecarError(
          "VALIDATION_FAILED",
          "OpenAI API response JSON does not match expected items schema",
          true,
        );
      }

      const items: Array<{ id: string; text: string }> = [];
      for (const item of parsed.items) {
        if (
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "text" in item &&
          typeof item.id === "string" &&
          typeof item.text === "string"
        ) {
          items.push({
            id: item.id,
            text: item.text,
          });
        }
      }

      return { items };
    } catch (error) {
      if (signal?.aborted) {
        throw sidecarError("JOB_CANCELLED", "AI generation cancelled", true);
      }
      if (controller.signal.aborted) {
        throw sidecarError("BACKEND_UNAVAILABLE", "OpenAI API request timed out", true);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
