import { describe, expect, it } from "vitest";
import { containsPii, isPiiRiskQuestion, redactPii } from "../src/ai/pii.js";

describe("AI PII Detection and Redaction", () => {
  describe("containsPii", () => {
    it("detects emails in various formats", () => {
      expect(containsPii("문의사항은 user@example.com 으로 주세요.")).toBe(true);
      expect(containsPii("Contact: john.doe+tag@sub.domain.co.kr")).toBe(true);
      expect(containsPii("일반 텍스트만 있는 문장입니다.")).toBe(false);
    });

    it("detects phone numbers in Korean and international formats", () => {
      expect(containsPii("010-1234-5678")).toBe(true);
      expect(containsPii("01012345678")).toBe(true);
      expect(containsPii("02-123-4567")).toBe(true);
      expect(containsPii("+82 10 9876 5432")).toBe(true);
      expect(containsPii("+1-555-123-4567")).toBe(true);
      expect(containsPii("수치는 2026년 9월 3일입니다.")).toBe(false);
    });

    it("detects Korean resident registration numbers", () => {
      expect(containsPii("주민번호: 900101-1234567")).toBe(true);
      expect(containsPii("주민번호: 0205154123456")).toBe(true);
    });

    it("detects credit card numbers", () => {
      expect(containsPii("카드번호: 1234-5678-9012-3456")).toBe(true);
      expect(containsPii("1234567890123456")).toBe(true);
    });
  });

  describe("redactPii", () => {
    it("redacts sensitive patterns with [REDACTED]", () => {
      const original = "제 이름은 비공개이고 전화는 010-9999-8888, 메일은 secret@test.com 입니다.";
      const redacted = redactPii(original);
      expect(redacted).not.toContain("010-9999-8888");
      expect(redacted).not.toContain("secret@test.com");
      expect(redacted).toContain("[REDACTED]");
    });

    it("leaves safe text unchanged", () => {
      const safe = "디자인이 깔끔하고 인터페이스가 직관적이라 매우 만족스럽습니다.";
      expect(redactPii(safe)).toBe(safe);
    });
  });

  describe("isPiiRiskQuestion", () => {
    it("identifies obvious PII-risk fields in Korean", () => {
      expect(isPiiRiskQuestion("이름을 입력해주세요")).toBe(true);
      expect(isPiiRiskQuestion("고객 성함")).toBe(true);
      expect(isPiiRiskQuestion("연락처")).toBe(true);
      expect(isPiiRiskQuestion("휴대폰 번호")).toBe(true);
      expect(isPiiRiskQuestion("배송지 주소")).toBe(true);
      expect(isPiiRiskQuestion("주민등록번호")).toBe(true);
      expect(isPiiRiskQuestion("환불 계좌번호")).toBe(true);
      expect(isPiiRiskQuestion("고객번호")).toBe(true);
      expect(isPiiRiskQuestion("회원 ID")).toBe(true);
    });

    it("identifies obvious PII-risk fields in English", () => {
      expect(isPiiRiskQuestion("Full Name")).toBe(true);
      expect(isPiiRiskQuestion("First name")).toBe(true);
      expect(isPiiRiskQuestion("Customer Name")).toBe(true);
      expect(isPiiRiskQuestion("Email Address")).toBe(true);
      expect(isPiiRiskQuestion("Phone Number")).toBe(true);
      expect(isPiiRiskQuestion("Home Address")).toBe(true);
      expect(isPiiRiskQuestion("Social Security Number (SSN)")).toBe(true);
      expect(isPiiRiskQuestion("Customer ID")).toBe(true);
      expect(isPiiRiskQuestion("Bank Account")).toBe(true);
    });

    it("allows non-PII general survey questions", () => {
      expect(isPiiRiskQuestion("서비스 만족도")).toBe(false);
      expect(isPiiRiskQuestion("제품 개선을 위한 자유로운 의견을 남겨주세요")).toBe(false);
      expect(isPiiRiskQuestion("이용 빈도")).toBe(false);
      expect(isPiiRiskQuestion("가장 선호하는 기능")).toBe(false);
      expect(isPiiRiskQuestion("Overall Experience")).toBe(false);
      expect(isPiiRiskQuestion("Feedback & Suggestions")).toBe(false);
    });
  });
});

