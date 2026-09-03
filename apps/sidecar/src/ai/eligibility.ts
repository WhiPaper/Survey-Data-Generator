import type {
  DomainSemanticOverride,
  FormSnapshot,
  NormalizedResponse,
  Question,
  QuestionId,
} from "@survey-synth/domain";
import type { SemanticInference } from "@survey-synth/statistics";
import { isPiiRiskQuestion, redactPii } from "./pii.js";
import { AI_GENERATION_POLICY_V1 } from "./policy.js";
import type { AiEligibleCell, StructuredContextField } from "./types.js";

export const getEffectiveSemanticType = (
  questionId: QuestionId,
  inferences?: readonly { questionId: QuestionId; inference: SemanticInference }[],
  overrides?: readonly DomainSemanticOverride[],
): string => {
  const override = overrides?.find((o) => o.questionId === questionId);
  if (override !== undefined) return override.value;
  const inferenceEntry = inferences?.find((i) => i.questionId === questionId);
  if (inferenceEntry !== undefined) return inferenceEntry.inference.inferred;
  return "unknown";
};

export const isQuestionAiEligible = (
  question: Question,
  inferences?: readonly { questionId: QuestionId; inference: SemanticInference }[],
  overrides?: readonly DomainSemanticOverride[],
): boolean => {
  if (question.kind !== "text") return false;
  const semanticType = getEffectiveSemanticType(question.id, inferences, overrides);
  if (semanticType !== "free_text") return false;
  if (isPiiRiskQuestion(question.title, question.description)) return false;
  return true;
};

const formatStructuredAnswer = (
  question: Question,
  response: NormalizedResponse,
): string | null => {
  const slot = response.answers[question.id];
  if (!slot || slot.state !== "answered") return null;

  switch (slot.value.kind) {
    case "single_choice":
      return slot.value.label;
    case "multi_choice":
      return slot.value.labels.join(", ");
    case "ordinal":
      return String(slot.value.value);
    case "text":
      return slot.value.value;
    default:
      return null;
  }
};

export const extractSafeStructuredContext = (
  form: FormSnapshot,
  response: NormalizedResponse,
  targetQuestionId: QuestionId,
  inferences?: readonly { questionId: QuestionId; inference: SemanticInference }[],
  overrides?: readonly DomainSemanticOverride[],
): readonly StructuredContextField[] => {
  const context: StructuredContextField[] = [];

  for (const question of form.questions) {
    if (question.id === targetQuestionId) continue;
    if (isPiiRiskQuestion(question.title, question.description)) continue;

    const semanticType = getEffectiveSemanticType(question.id, inferences, overrides);
    if (
      semanticType === "identifier" ||
      semanticType === "personal_identifier" ||
      semanticType === "formatted_string"
    ) {
      continue;
    }

    if (
      question.kind !== "single_choice" &&
      question.kind !== "multi_choice" &&
      question.kind !== "ordinal" &&
      !(question.kind === "text" && semanticType === "numeric")
    ) {
      continue;
    }

    const answer = formatStructuredAnswer(question, response);
    if (answer !== null && answer.trim() !== "") {
      context.push({ title: question.title, answer: answer.trim() });
    }
  }

  return context.slice(0, 5);
};

export const extractSourceExamples = (
  questionId: QuestionId,
  originalResponses: readonly NormalizedResponse[],
  limit: number = AI_GENERATION_POLICY_V1.maxSourceExamples,
): readonly string[] => {
  const examples: string[] = [];

  for (const response of originalResponses) {
    const slot = response.answers[questionId];
    if (slot && slot.state === "answered" && slot.value.kind === "text") {
      const text = slot.value.value.trim();
      if (text.length > 0) {
        const redacted = redactPii(text);
        if (redacted.length > 0 && !examples.includes(redacted)) {
          examples.push(redacted);
          if (examples.length >= limit) break;
        }
      }
    }
  }

  return examples;
};

export const getEligibleDeferredCells = (
  form: FormSnapshot,
  syntheticResponses: readonly NormalizedResponse[],
  originalResponses: readonly NormalizedResponse[],
  inferences?: readonly { questionId: QuestionId; inference: SemanticInference }[],
  overrides?: readonly DomainSemanticOverride[],
): readonly AiEligibleCell[] => {
  const eligibleQuestions = form.questions.filter((q) =>
    isQuestionAiEligible(q, inferences, overrides),
  );
  if (eligibleQuestions.length === 0) return [];

  const eligibleCells: AiEligibleCell[] = [];

  for (const question of eligibleQuestions) {
    const sourceExamples = extractSourceExamples(question.id, originalResponses);

    for (const response of syntheticResponses) {
      const slot = response.answers[question.id];
      const reachedState = response.path.questions[question.id];
      const isReached = reachedState === "reached";

      // Deferred AI free text applies ONLY to reached questions that are answered with empty text.
      // Existing nonblank text, skipped, not_reached, and indeterminate states are strictly preserved.
      if (
        slot &&
        slot.state === "answered" &&
        slot.value.kind === "text" &&
        slot.value.value.trim() === "" &&
        isReached
      ) {
        const structuredContext = extractSafeStructuredContext(
          form,
          response,
          question.id,
          inferences,
          overrides,
        );

        eligibleCells.push({
          responseId: response.responseId,
          questionId: question.id,
          questionTitle: question.title,
          questionDescription: question.description,
          structuredContext,
          sourceExamples,
        });
      }
    }
  }

  return eligibleCells;
};
