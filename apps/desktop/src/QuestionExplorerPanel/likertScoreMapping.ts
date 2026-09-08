import type { QuestionView } from "./model";

export type LikertScoreMapping = {
  questionId: string;
  optionScores: Array<{ optionKey: string; score: number }>;
};

const normalize = (value: string): string =>
  value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();

const scoreSets = [
  ["매우 그렇다", "그렇다", "보통이다", "그렇지 않다", "전혀 그렇지 않다"],
  ["Strongly Agree", "Agree", "Neutral", "Disagree", "Strongly Disagree"],
  ["非常认同", "比较认同", "一般", "比较不认同", "非常不认同"],
  [
    "非常にそう思う",
    "ややそう思う",
    "どちらともいえない",
    "あまりそう思わない",
    "全くそう思わない",
  ],
] as const;

export const recognizeLikertScoreMapping = (question: QuestionView): LikertScoreMapping | null => {
  if (
    question.kind !== "single_choice" ||
    question.affectsNavigation ||
    question.options.length !== 5
  )
    return null;

  const optionsByLabel = new Map(
    question.options.map((option) => [normalize(option.label), option]),
  );
  if (optionsByLabel.size !== 5) return null;

  for (const scoreSet of scoreSets) {
    if (!scoreSet.every((label) => optionsByLabel.has(normalize(label)))) continue;
    return {
      questionId: question.id,
      optionScores: scoreSet.map((label, index) => ({
        optionKey: optionsByLabel.get(normalize(label))!.key,
        score: 5 - index,
      })),
    };
  }
  return null;
};
