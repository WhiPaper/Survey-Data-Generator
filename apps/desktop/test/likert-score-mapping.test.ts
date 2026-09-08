import { describe, expect, it } from "vitest";

import { recognizeLikertScoreMapping } from "../src/QuestionExplorerPanel/likertScoreMapping";
import type { QuestionView } from "../src/QuestionExplorerPanel/model";

const question = (labels: string[]): QuestionView => ({
  id: "q-likert",
  title: "만족도",
  kind: "single_choice",
  options: labels.map((label, index) => ({ key: `option-${index}`, label })),
});

describe("Likert score mapping recognition", () => {
  it("recognizes the exact Korean labels in any Form option order", () => {
    expect(
      recognizeLikertScoreMapping(
        question(["보통이다", "전혀 그렇지 않다", "매우 그렇다", "그렇지 않다", "그렇다"]),
      ),
    ).toEqual({
      questionId: "q-likert",
      optionScores: [
        { optionKey: "option-2", score: 5 },
        { optionKey: "option-4", score: 4 },
        { optionKey: "option-0", score: 3 },
        { optionKey: "option-3", score: 2 },
        { optionKey: "option-1", score: 1 },
      ],
    });
  });

  it.each([
    { labels: ["Strongly Agree", "Agree", "Neutral", "Disagree", "Strongly Disagree"] },
    { labels: ["非常认同", "比较认同", "一般", "比较不认同", "非常不认同"] },
    {
      labels: [
        "非常にそう思う",
        "ややそう思う",
        "どちらともいえない",
        "あまりそう思わない",
        "全くそう思わない",
      ],
    },
  ])("recognizes an exact supported label set", ({ labels }) => {
    expect(recognizeLikertScoreMapping(question(labels))).not.toBeNull();
  });

  it("does not infer a score mapping for an arbitrary five-choice question", () => {
    expect(recognizeLikertScoreMapping(question(["A", "B", "C", "D", "E"]))).toBeNull();
  });

  it("does not offer score interpretation for a routing question", () => {
    const routingQuestion = question([
      "Strongly Agree",
      "Agree",
      "Neutral",
      "Disagree",
      "Strongly Disagree",
    ]);
    routingQuestion.affectsNavigation = true;
    expect(recognizeLikertScoreMapping(routingQuestion)).toBeNull();
  });
});
