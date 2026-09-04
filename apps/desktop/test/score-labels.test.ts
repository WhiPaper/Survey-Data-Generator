import { describe, expect, it } from "vitest";

import { recognizeScoreMapping } from "../src/lib/score-labels";

describe("recognizeScoreMapping", () => {
  it("recognizes the supported five-point labels in Korean, English, Chinese, and Japanese", () => {
    for (const labels of [
      ["매우 그렇다", "그렇다", "보통이다", "그렇지 않다", "전혀 그렇지 않다"],
      ["Strongly agree", "Agree", "Neutral", "Disagree", "Strongly disagree"],
      ["非常同意", "同意", "中立", "不同意", "非常不同意"],
      ["非常认同", "比较认同", "一般", "比较不认同", "非常不认同"],
      ["とてもそう思う", "そう思う", "どちらでもない", "そう思わない", "まったくそう思わない"],
      ["非常にそう思う", "ややそう思う", "どちらともいえない", "あまりそう思わない", "全くそう思わない"],
    ]) {
      const mapping = recognizeScoreMapping(labels);
      expect(mapping && labels.map((label) => mapping.get(label))).toEqual([5, 4, 3, 2, 1]);
    }
  });

  it("does not classify an arbitrary five-choice question as a score scale", () => {
    expect(recognizeScoreMapping(["A", "B", "C", "D", "E"])).toBeNull();
  });
});
