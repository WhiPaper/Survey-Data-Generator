import { containsPii } from "./pii.js";
import { AI_GENERATION_POLICY_V1 } from "./policy.js";
import { isTooSimilar } from "./similarity.js";

export interface ValidationSuccess {
  readonly valid: true;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly reason: string;
}

export type TextValidationResult = ValidationSuccess | ValidationFailure;

export const validateGeneratedText = (
  text: unknown,
  sourceExamples: readonly string[],
): TextValidationResult => {
  if (typeof text !== "string") {
    return { valid: false, reason: "Output is not a string" };
  }
  const trimmed = text.trim();
  if (trimmed.length < AI_GENERATION_POLICY_V1.minTextLength) {
    return { valid: false, reason: "Output text is empty or too short" };
  }
  if (trimmed.length > AI_GENERATION_POLICY_V1.maxTextLength) {
    return { valid: false, reason: "Output text exceeds maximum length bound" };
  }
  if (containsPii(trimmed)) {
    return { valid: false, reason: "Output text contains prohibited PII pattern" };
  }
  /* eslint-disable-next-line no-control-regex */
  if (/^[\s\u0000-\u001f]*[=@]/.test(trimmed)) {
    return { valid: false, reason: "Output text begins with potentially unsafe formula prefix" };
  }
  if (isTooSimilar(trimmed, sourceExamples)) {
    return { valid: false, reason: "Output text is too similar to original source examples" };
  }
  return { valid: true };
};
