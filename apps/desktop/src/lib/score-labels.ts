const scoreLabelGroups = [
  {
    score: 5,
    labels: [
      "매우 그렇다",
      "강하게 동의",
      "strongly agree",
      "very positive",
      "非常同意",
      "非常积极",
      "非常认同",
      "とてもそう思う",
      "強く同意",
      "非常にそう思う",
    ],
  },
  {
    score: 4,
    labels: [
      "그렇다",
      "동의",
      "agree",
      "positive",
      "同意",
      "积极",
      "比较认同",
      "そう思う",
      "同意する",
      "ややそう思う",
    ],
  },
  {
    score: 3,
    labels: [
      "보통이다",
      "보통",
      "중립",
      "neutral",
      "neither agree nor disagree",
      "中立",
      "一般",
      "どちらともいえない",
      "どちらでもない",
      "普通",
    ],
  },
  {
    score: 2,
    labels: [
      "그렇지 않다",
      "비동의",
      "disagree",
      "negative",
      "不同意",
      "消极",
      "比较不认同",
      "そう思わない",
      "同意しない",
      "あまりそう思わない",
    ],
  },
  {
    score: 1,
    labels: [
      "전혀 그렇지 않다",
      "강하게 비동의",
      "strongly disagree",
      "very negative",
      "非常不同意",
      "非常消极",
      "非常不认同",
      "まったくそう思わない",
      "強く反対",
      "全くそう思わない",
    ],
  },
] as const;

const normalize = (label: string): string => label.trim().toLocaleLowerCase();

export type ScoreMapping = ReadonlyMap<string, number>;

export const ratiosForScoreMean = (
  labels: readonly string[],
  currentRatios: readonly number[],
  scores: ScoreMapping,
  mean: number,
): readonly number[] => {
  const next = [...currentRatios];
  const currentMean = labels.reduce(
    (sum, label, index) => sum + (scores.get(label) ?? 3) * (currentRatios[index] ?? 0),
    0,
  );
  let remaining = Math.abs(mean - currentMean);
  const direction = mean >= currentMean ? 1 : -1;
  const order = labels.map((label, index) => ({ label, index }));
  order.sort((a, b) =>
    direction > 0
      ? (scores.get(b.label) ?? 0) - (scores.get(a.label) ?? 0)
      : (scores.get(a.label) ?? 0) - (scores.get(b.label) ?? 0),
  );
  for (const destination of order) {
    for (const donor of order) {
      const gap = direction * ((scores.get(destination.label) ?? 3) - (scores.get(donor.label) ?? 3));
      if (gap <= 0 || remaining <= 0 || destination.index === donor.index) continue;
      const transfer = Math.min(next[donor.index] ?? 0, remaining / gap);
      next[donor.index] = (next[donor.index] ?? 0) - transfer;
      next[destination.index] = (next[destination.index] ?? 0) + transfer;
      remaining -= transfer * gap;
    }
  }
  return next.map((ratio) => Math.max(0, ratio));
};

export const recognizeScoreMapping = (labels: readonly string[]): ScoreMapping | null => {
  if (labels.length !== 5) return null;
  const scores = labels.map((label) => {
    const normalized = normalize(label);
    return scoreLabelGroups.find((group) => (group.labels as readonly string[]).includes(normalized))?.score;
  });
  if (scores.some((score) => score === undefined) || new Set(scores).size !== 5) return null;
  return new Map(labels.map((label, index) => [label, scores[index]!]));
};
