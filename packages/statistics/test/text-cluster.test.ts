import { describe, expect, it } from "vitest";
import {
  clusterTextResponses,
  computeUniversalSimilarity,
  normalizeUniversalText,
} from "../src/text-cluster.js";

describe("Universal Text Clustering", () => {
  it("normalizes multilingual text preserving Hanja, English, and Hangul jamo", () => {
    expect(normalizeUniversalText("大邱廣域市")).toBe("大邱廣域市");
    expect(normalizeUniversalText("Google Inc.")).toBe("google inc");
    // 한글 음절은 자모로 분해됨
    expect(normalizeUniversalText("대구")).toBe("ㄷㅐㄱㅜ");
  });

  it("clusters Korean variations with typos and whitespace", () => {
    const responses = [
      "대구",
      "대구광역시",
      "대구시",
      "대구",
      "대구싀", // 오타
      "서울",
      "서울특별시",
      "서울시",
      "서울",
    ];

    const clusters = clusterTextResponses(responses);
    expect(clusters.length).toBe(2);

    const daeguCluster = clusters.find((c) => c.label.includes("대구"));
    const seoulCluster = clusters.find((c) => c.label.includes("서울"));

    expect(daeguCluster).toBeDefined();
    expect(daeguCluster?.count).toBe(5);
    expect(daeguCluster?.memberTexts).toContain("대구");
    expect(daeguCluster?.memberTexts).toContain("대구광역시");
    expect(daeguCluster?.memberTexts).toContain("대구시");
    expect(daeguCluster?.memberTexts).toContain("대구싀");

    expect(seoulCluster).toBeDefined();
    expect(seoulCluster?.count).toBe(4);
    expect(seoulCluster?.memberTexts).toContain("서울");
    expect(seoulCluster?.memberTexts).toContain("서울특별시");
    expect(seoulCluster?.memberTexts).toContain("서울시");
  });

  it("clusters Hanja (Chinese characters) variations accurately", () => {
    const responses = [
      "大邱",
      "大邱市",
      "大邱廣域市",
      "大邱",
      "首爾",
      "首爾特別市",
      "首爾",
    ];

    const clusters = clusterTextResponses(responses);
    expect(clusters.length).toBe(2);

    const daeguHanja = clusters.find((c) => c.label.includes("大邱"));
    const seoulHanja = clusters.find((c) => c.label.includes("首爾"));

    expect(daeguHanja).toBeDefined();
    expect(daeguHanja?.count).toBe(4);
    expect(daeguHanja?.memberTexts).toContain("大邱");
    expect(daeguHanja?.memberTexts).toContain("大邱市");
    expect(daeguHanja?.memberTexts).toContain("大邱廣域市");

    expect(seoulHanja).toBeDefined();
    expect(seoulHanja?.count).toBe(3);
    expect(seoulHanja?.memberTexts).toContain("首爾");
    expect(seoulHanja?.memberTexts).toContain("首爾特別市");
  });

  it("clusters English brand/job variations accurately", () => {
    const responses = [
      "Google",
      "Google LLC",
      "google inc.",
      "google",
      "Apple",
      "Apple Inc",
      "apple",
    ];

    const clusters = clusterTextResponses(responses);
    expect(clusters.length).toBe(2);

    const googleCluster = clusters.find((c) => c.label.toLowerCase().includes("google"));
    const appleCluster = clusters.find((c) => c.label.toLowerCase().includes("apple"));

    expect(googleCluster).toBeDefined();
    expect(googleCluster?.count).toBe(4);

    expect(appleCluster).toBeDefined();
    expect(appleCluster?.count).toBe(3);
  });

  it("computes high similarity for substring inclusions across scripts", () => {
    expect(computeUniversalSimilarity("大邱", "大邱廣域市")).toBeGreaterThanOrEqual(0.75);
    expect(computeUniversalSimilarity("Samsung", "Samsung Electronics")).toBeGreaterThanOrEqual(0.75);
    expect(computeUniversalSimilarity("대구", "대구광역시")).toBeGreaterThanOrEqual(0.75);
    expect(computeUniversalSimilarity("대구", "부산")).toBeLessThan(0.3);
    expect(computeUniversalSimilarity("大邱", "釜山")).toBeLessThan(0.3);
  });
});

