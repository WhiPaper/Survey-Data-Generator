import { describe, expect, it } from "vitest";
import type {
  FormId,
  FormSnapshot,
  NormalizedResponse,
  QuestionId,
  ResponseId,
  SectionId,
} from "@survey-synth/domain";
import {
  extractSafeStructuredContext,
  extractSourceExamples,
  getEffectiveSemanticType,
  getEligibleDeferredCells,
  isQuestionAiEligible,
} from "../src/ai/eligibility.js";

const createMockForm = (overrides?: Partial<FormSnapshot>): FormSnapshot => ({
  formId: "form_1" as FormId,
  title: "고객 피드백 설문",
  description: "테스트 설문",
  schemaHash: "hash123",
  sections: [
    {
      id: "sec_1" as SectionId,
      index: 0,
      title: "기본 섹션",
      questions: [
        "q_rating" as QuestionId,
        "q_comment" as QuestionId,
        "q_name" as QuestionId,
        "q_email" as QuestionId,
        "q_id" as QuestionId,
        "q_unreached_comment" as QuestionId,
      ],
    },
  ],
  questions: [
    {
      id: "q_rating" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 0,
      kind: "ordinal",
      title: "만족도",
      scale: { min: 1, max: 5 },
      presentation: "linear_scale",
    },
    {
      id: "q_comment" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 1,
      kind: "text",
      title: "개선 의견",
      presentation: "paragraph",
    },
    {
      id: "q_name" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 2,
      kind: "text",
      title: "고객 성함",
      presentation: "short_answer",
    },
    {
      id: "q_email" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 3,
      kind: "text",
      title: "Email Address",
      presentation: "short_answer",
    },
    {
      id: "q_id" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 4,
      kind: "text",
      title: "고객번호",
      presentation: "short_answer",
    },
    {
      id: "q_unreached_comment" as QuestionId,
      sectionId: "sec_1" as SectionId,
      index: 5,
      kind: "text",
      title: "추가 상세 피드백",
      presentation: "paragraph",
    },
  ],
  groups: [],
  logic: {},
  capturedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

describe("AI Eligibility & Deferred-state resolution", () => {
  it("determines effective semantic type with override > inference", () => {
    const q1 = "q_1" as QuestionId;
    const inferences = [
      {
        questionId: q1,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
    ];
    const overrides = [{ questionId: q1, value: "identifier" as const, updatedAt: "2026-09-01" }];

    // With override, override wins
    expect(getEffectiveSemanticType(q1, inferences, overrides)).toBe("identifier");

    // Without override, inference wins
    expect(getEffectiveSemanticType(q1, inferences, [])).toBe("free_text");

    // Without either, unknown
    expect(getEffectiveSemanticType("q_other" as QuestionId, [], [])).toBe("unknown");
  });

  it("excludes non-text questions and non-free-text types", () => {
    const form = createMockForm();
    const ratingQ = form.questions.find((q) => q.id === "q_rating")!;
    const commentQ = form.questions.find((q) => q.id === "q_comment")!;

    expect(isQuestionAiEligible(ratingQ, [], [])).toBe(false);

    // With free_text inference, comment is eligible
    const inferences = [
      {
        questionId: "q_comment" as QuestionId,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
    ];
    expect(isQuestionAiEligible(commentQ, inferences, [])).toBe(true);

    // With identifier override, comment is excluded
    const overrides = [
      {
        questionId: "q_comment" as QuestionId,
        value: "identifier" as const,
        updatedAt: "2026-09-01",
      },
    ];
    expect(isQuestionAiEligible(commentQ, inferences, overrides)).toBe(false);
  });

  it("excludes PII-risk questions in Korean and English", () => {
    const form = createMockForm();
    const nameQ = form.questions.find((q) => q.id === "q_name")!;
    const emailQ = form.questions.find((q) => q.id === "q_email")!;
    const idQ = form.questions.find((q) => q.id === "q_id")!;

    const inferences = [
      {
        questionId: nameQ.id,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
      {
        questionId: emailQ.id,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
      {
        questionId: idQ.id,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
    ];

    expect(isQuestionAiEligible(nameQ, inferences, [])).toBe(false);
    expect(isQuestionAiEligible(emailQ, inferences, [])).toBe(false);
    expect(isQuestionAiEligible(idQ, inferences, [])).toBe(false);
  });

  it("identifies deferred cells: only answered with empty text on reached path", () => {
    const form = createMockForm();
    const inferences = [
      {
        questionId: "q_comment" as QuestionId,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
      {
        questionId: "q_unreached_comment" as QuestionId,
        inference: { inferred: "free_text" as const, confidence: 0.9, sampleSize: 10 },
      },
    ];

    const syntheticResponses: NormalizedResponse[] = [
      // 1. Eligible: answered with empty string on reached path
      {
        responseId: "resp_synth_1" as ResponseId,
        origin: "synthetic",
        createdAt: "2026-09-01T10:00:00Z",
        submittedAt: "2026-09-01T10:00:00Z",
        path: {
          sections: { sec_1: "reached" },
          questions: { q_comment: "reached", q_unreached_comment: "reached" },
        },
        answers: {
          q_comment: { state: "answered", value: { kind: "text", value: "" } },
          q_rating: { state: "answered", value: { kind: "ordinal", value: 4 } },
        },
      },
      // 2. Preserved: answered with NONBLANK structured text
      {
        responseId: "resp_synth_2" as ResponseId,
        origin: "synthetic",
        createdAt: "2026-09-01T10:05:00Z",
        submittedAt: "2026-09-01T10:05:00Z",
        path: {
          sections: { sec_1: "reached" },
          questions: { q_comment: "reached" },
        },
        answers: {
          q_comment: { state: "answered", value: { kind: "text", value: "이미 입력된 기존 내용" } },
        },
      },
      // 3. Preserved: skipped optional question
      {
        responseId: "resp_synth_3" as ResponseId,
        origin: "synthetic",
        createdAt: "2026-09-01T10:10:00Z",
        submittedAt: "2026-09-01T10:10:00Z",
        path: {
          sections: { sec_1: "reached" },
          questions: { q_comment: "reached" },
        },
        answers: {
          q_comment: { state: "skipped" },
        },
      },
      // 4. Preserved: not reached question due to branching
      {
        responseId: "resp_synth_4" as ResponseId,
        origin: "synthetic",
        createdAt: "2026-09-01T10:15:00Z",
        submittedAt: "2026-09-01T10:15:00Z",
        path: {
          sections: { sec_1: "reached" },
          questions: { q_unreached_comment: "not_reached" },
        },
        answers: {
          q_unreached_comment: { state: "not_reached" },
        },
      },
      // 5. Preserved: indeterminate state
      {
        responseId: "resp_synth_5" as ResponseId,
        origin: "synthetic",
        createdAt: "2026-09-01T10:20:00Z",
        submittedAt: "2026-09-01T10:20:00Z",
        path: {
          sections: { sec_1: "reached" },
          questions: { q_comment: "indeterminate" },
        },
        answers: {
          q_comment: { state: "indeterminate" },
        },
      },
    ];

    const eligible = getEligibleDeferredCells(form, syntheticResponses, [], inferences, []);
    expect(eligible.length).toBe(1);
    expect(eligible[0]!.responseId).toBe("resp_synth_1");
    expect(eligible[0]!.questionId).toBe("q_comment");
  });

  it("extracts safe structured context without leaking PII or target question", () => {
    const form = createMockForm();
    const response: NormalizedResponse = {
      responseId: "r1" as ResponseId,
      origin: "synthetic",
      createdAt: "2026-09-01T00:00:00Z",
      submittedAt: "2026-09-01T00:00:00Z",
      path: { sections: {}, questions: {} },
      answers: {
        q_rating: { state: "answered", value: { kind: "ordinal", value: 5 } },
        q_name: { state: "answered", value: { kind: "text", value: "홍길동" } },
        q_email: { state: "answered", value: { kind: "text", value: "test@example.com" } },
        q_comment: { state: "answered", value: { kind: "text", value: "" } },
      },
    };

    const context = extractSafeStructuredContext(form, response, "q_comment" as QuestionId, [], []);
    // Only q_rating should be included; q_name and q_email are PII; q_comment is the target question
    expect(context).toEqual([{ title: "만족도", answer: "5" }]);
  });

  it("extracts source examples with PII redaction and bounds", () => {
    const originals: NormalizedResponse[] = [
      {
        responseId: "orig_1" as ResponseId,
        origin: "original",
        createdAt: "2026-09-01T00:00:00Z",
        submittedAt: "2026-09-01T00:00:00Z",
        path: { sections: {}, questions: {} },
        answers: {
          q_comment: {
            state: "answered",
            value: {
              kind: "text",
              value: "배송이 빨라서 좋았습니다. 문의는 010-1234-5678로 했습니다.",
            },
          },
        },
      },
      {
        responseId: "orig_2" as ResponseId,
        origin: "original",
        createdAt: "2026-09-01T00:00:00Z",
        submittedAt: "2026-09-01T00:00:00Z",
        path: { sections: {}, questions: {} },
        answers: {
          q_comment: {
            state: "answered",
            value: { kind: "text", value: "포장이 깔끔해요. 연락처는 test@domain.com 입니다." },
          },
        },
      },
      {
        responseId: "orig_3" as ResponseId,
        origin: "original",
        createdAt: "2026-09-01T00:00:00Z",
        submittedAt: "2026-09-01T00:00:00Z",
        path: { sections: {}, questions: {} },
        answers: {
          q_comment: {
            state: "answered",
            value: { kind: "text", value: "가격 대비 품질이 우수합니다." },
          },
        },
      },
      {
        responseId: "orig_4" as ResponseId,
        origin: "original",
        createdAt: "2026-09-01T00:00:00Z",
        submittedAt: "2026-09-01T00:00:00Z",
        path: { sections: {}, questions: {} },
        answers: {
          q_comment: {
            state: "answered",
            value: { kind: "text", value: "네 번째 의견이지만 상한(3)에 걸려 제외되어야 합니다." },
          },
        },
      },
    ];

    const examples = extractSourceExamples("q_comment" as QuestionId, originals, 3);
    expect(examples.length).toBe(3);
    // PII must be redacted before being used as an example
    expect(examples[0]).toContain("[REDACTED]");
    expect(examples[0]).not.toContain("010-1234-5678");
    expect(examples[1]).toContain("[REDACTED]");
    expect(examples[1]).not.toContain("test@domain.com");
    expect(examples[2]).toBe("가격 대비 품질이 우수합니다.");
  });
});
