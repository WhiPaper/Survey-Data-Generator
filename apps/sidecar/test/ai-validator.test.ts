import { describe, expect, it } from "vitest";
import { validateGeneratedText } from "../src/ai/validator.js";

describe("AI Generated Text Validator", () => {
  const sourceExamples = ["배송이 매우 빨라 만족스럽습니다."];

  it("accepts valid, clean generated text", () => {
    const result = validateGeneratedText(
      "전반적인 제품 품질과 사용 편의성에 크게 만족했습니다.",
      sourceExamples,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects non-string outputs", () => {
    const result = validateGeneratedText(12345 as unknown as string, sourceExamples);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("not a string");
    }
  });

  it("rejects text that is too short or empty", () => {
    const emptyResult = validateGeneratedText("   ", sourceExamples);
    expect(emptyResult.valid).toBe(false);

    const singleCharResult = validateGeneratedText("네", sourceExamples);
    // minTextLength is 2, so 1 character is rejected
    expect(singleCharResult.valid).toBe(false);
  });

  it("rejects text that exceeds maximum length bound", () => {
    const hugeText = "가".repeat(1001);
    const result = validateGeneratedText(hugeText, sourceExamples);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("maximum length");
    }
  });

  it("rejects generated text containing PII patterns", () => {
    const withEmail = validateGeneratedText(
      "궁금한 점은 test@company.com 으로 회신 바랍니다.",
      sourceExamples,
    );
    expect(withEmail.valid).toBe(false);
    if (!withEmail.valid) {
      expect(withEmail.reason).toContain("PII");
    }

    const withPhone = validateGeneratedText("제 연락처는 010-8888-7777 입니다.", sourceExamples);
    expect(withPhone.valid).toBe(false);
  });

  it("rejects formula injection prefixes", () => {
    const withFormula = validateGeneratedText("=1+1", sourceExamples);
    expect(withFormula.valid).toBe(false);
    if (!withFormula.valid) {
      expect(withFormula.reason).toContain("formula prefix");
    }

    const withAtFormula = validateGeneratedText("@SUM(A1:A10)", sourceExamples);
    expect(withAtFormula.valid).toBe(false);
  });

  it("rejects text that is too similar to source examples", () => {
    const exactCopy = validateGeneratedText("배송이 매우 빨라 만족스럽습니다.", sourceExamples);
    expect(exactCopy.valid).toBe(false);
    if (!exactCopy.valid) {
      expect(exactCopy.reason).toContain("too similar");
    }
  });
});
