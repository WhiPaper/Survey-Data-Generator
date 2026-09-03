import { describe, expect, it } from "vitest";
import { isTooSimilar } from "../src/ai/similarity.js";

describe("AI Similarity & Source Copy Protection", () => {
  const sourceExamples = [
    "배송이 정말 빠르고 포장 상태가 매우 우수했습니다.",
    "가격 대비 가성비가 훌륭해서 재구매 의사 있습니다.",
  ];

  it("detects normalized exact matches", () => {
    // Exact match with whitespace and punctuation variation
    expect(isTooSimilar("배송이 정말 빠르고 포장 상태가 매우 우수했습니다!", sourceExamples)).toBe(
      true,
    );
    expect(
      isTooSimilar("  배송이 정말 빠르고  포장 상태가 매우 우수했습니다  ", sourceExamples),
    ).toBe(true);
  });

  it("detects long substring matches (>= 20 characters)", () => {
    // More than 20 chars copied verbatim with minor prefix/suffix
    const plagiarized =
      "솔직히 말씀드리면 배송이 정말 빠르고 포장 상태가 매우 우수했습니다 그리고 기사님도 친절했어요.";
    expect(isTooSimilar(plagiarized, sourceExamples)).toBe(true);
  });

  it("detects heavy paraphrasing via bigram Jaccard similarity", () => {
    // Heavy character overlap with source example 2
    const heavyOverlap = "가격대비 가성비가 훌륭해서 재구매 의사가 있습니다";
    expect(isTooSimilar(heavyOverlap, sourceExamples)).toBe(true);
  });

  it("permits fresh, diverse generated phrasing", () => {
    const novelAnswers = [
      "주문 다음 날 바로 도착해서 놀랐고 제품 마감도 깔끔합니다.",
      "품질이 기대 이상이라 지인들에게도 적극 추천하고 싶네요.",
      "고객센터 응대가 친절하여 문제 해결이 빨랐습니다.",
    ];

    for (const answer of novelAnswers) {
      expect(isTooSimilar(answer, sourceExamples)).toBe(false);
    }
  });

  it("avoids false positives on short generic answers", () => {
    const shortExamples = ["좋았습니다", "만족합니다"];
    // Different short phrase should NOT be rejected
    expect(isTooSimilar("괜찮았어요", shortExamples)).toBe(false);
    expect(isTooSimilar("보통입니다", shortExamples)).toBe(false);
    expect(isTooSimilar("아쉬웠습니다", shortExamples)).toBe(false);
  });

  it("returns false when source examples list is empty", () => {
    expect(isTooSimilar("어떤 텍스트라도 비교 대상이 없으면 통과해야 합니다.", [])).toBe(false);
  });
});
