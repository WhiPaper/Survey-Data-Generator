import type { FrozenRunTarget, RunTargetPresentation } from "@survey-synth/contracts";

import { backendFailure } from "../errors";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const formQuestions = (form: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(form.questions)
    ? form.questions.flatMap((value) => {
        const question = asRecord(value);
        return question ? [question] : [];
      })
    : [];

const historicalQuestion = (
  form: Record<string, unknown>,
  questionId: string,
): Record<string, unknown> => {
  const question = formQuestions(form).find((candidate) => candidate.id === questionId);
  if (!question) {
    throw backendFailure("INTERNAL", "Historical Run question is missing from its Form snapshot");
  }
  return question;
};

const historicalQuestionTitle = (form: Record<string, unknown>, questionId: string): string => {
  const question = historicalQuestion(form, questionId);
  return typeof question.title === "string" && question.title.trim().length > 0
    ? question.title
    : questionId;
};

const historicalOptionLabel = (
  form: Record<string, unknown>,
  questionId: string,
  optionKey: string,
): string => {
  const question = historicalQuestion(form, questionId);
  const options = Array.isArray(question.options) ? question.options : [];
  const option = options
    .map(asRecord)
    .find((candidate) => candidate !== null && candidate.key === optionKey);
  if (!option) {
    throw backendFailure("INTERNAL", "Historical Run option is missing from its Form snapshot");
  }
  return typeof option.label === "string" && option.label.trim().length > 0
    ? option.label
    : optionKey;
};

export const buildRunTargetPresentations = (
  form: Record<string, unknown>,
  targets: readonly FrozenRunTarget[],
): RunTargetPresentation[] =>
  targets.map((target) => {
    if (target.kind === "mean") {
      const questionTitle = historicalQuestionTitle(form, target.questionId);
      return {
        targetId: target.id,
        questionId: target.questionId,
        questionTitle,
        subjectLabel: questionTitle,
      };
    }

    if (target.kind === "conditional_share") {
      historicalQuestionTitle(form, target.population.valueGroup.questionId);
      return {
        targetId: target.id,
        questionId: target.questionId,
        questionTitle: historicalQuestionTitle(form, target.questionId),
        subjectLabel: historicalOptionLabel(form, target.questionId, target.optionKey),
        populationLabel: target.population.valueGroup.name,
      };
    }

    const subject = target.subject;
    if (subject.kind === "value_group") {
      return {
        targetId: target.id,
        questionId: subject.valueGroup.questionId,
        questionTitle: historicalQuestionTitle(form, subject.valueGroup.questionId),
        subjectLabel: subject.valueGroup.name,
      };
    }

    return {
      targetId: target.id,
      questionId: subject.questionId,
      questionTitle: historicalQuestionTitle(form, subject.questionId),
      subjectLabel: historicalOptionLabel(form, subject.questionId, subject.optionKey),
    };
  });
