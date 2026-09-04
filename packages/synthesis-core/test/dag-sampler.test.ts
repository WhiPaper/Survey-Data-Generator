import { describe, expect, it } from "vitest";
import type {
  FormSnapshot,
  NormalizedResponse,
  OptionKey,
  QuestionId,
  SectionId,
} from "@survey-synth/domain";
import {
  answerSignature,
  generateSyntheticDataset,
} from "../src/generative/index.js";

const multiLanguageForm: FormSnapshot = {
  formId: "bambam-festa" as never,
  title: "BamBam Festa Multi-language Survey",
  capturedAt: "2026-08-27T00:00:00.000Z",
  schemaHash: "hash-bambam",
  sections: [
    {
      id: "sec_lang" as SectionId,
      title: "Language Selection",
      order: 0,
      questionIds: ["q_lang" as QuestionId],
    },
    {
      id: "sec_ko" as SectionId,
      title: "Korean Questions",
      order: 1,
      questionIds: [
        "q_ko_gender" as QuestionId,
        "q_ko_age" as QuestionId,
        "q_ko_sat" as QuestionId,
        "q_ko_submit" as QuestionId,
      ],
    },
    {
      id: "sec_en" as SectionId,
      title: "English Questions",
      order: 2,
      questionIds: ["q_en_gender" as QuestionId, "q_en_age" as QuestionId, "q_en_sat" as QuestionId],
    },
  ],
  groups: [],
  logic: {
    entrySectionId: "sec_lang" as SectionId,
    sections: [
      {
        id: "sec_lang" as SectionId,
        order: 0,
        questionIds: ["q_lang" as QuestionId],
      },
      {
        id: "sec_ko" as SectionId,
        order: 1,
        questionIds: [
          "q_ko_gender" as QuestionId,
          "q_ko_age" as QuestionId,
          "q_ko_sat" as QuestionId,
          "q_ko_submit" as QuestionId,
        ],
      },
      {
        id: "sec_en" as SectionId,
        order: 2,
        questionIds: ["q_en_gender" as QuestionId, "q_en_age" as QuestionId, "q_en_sat" as QuestionId],
      },
    ],
    transitions: [
      {
        sourceQuestionId: "q_lang" as QuestionId,
        optionKey: "ko" as OptionKey,
        destination: { type: "section", sectionId: "sec_ko" as SectionId },
        evidence: "api_confirmed",
      },
      {
        sourceQuestionId: "q_lang" as QuestionId,
        optionKey: "en" as OptionKey,
        destination: { type: "section", sectionId: "sec_en" as SectionId },
        evidence: "api_confirmed",
      },
      {
        sourceQuestionId: "q_ko_submit" as QuestionId,
        optionKey: "yes" as OptionKey,
        destination: { type: "submit" },
        evidence: "api_confirmed",
      },
    ],
    coverage: "none",
    hasRestartFlow: false,
  },
  questions: [
    {
      id: "q_lang" as QuestionId,
      title: "언어 선택",
      sectionId: "sec_lang" as SectionId,
      required: true,
      affectsNavigation: true,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "ko" as OptionKey, label: "한국어" },
        { key: "en" as OptionKey, label: "English" },
      ],
      shuffle: false,
    },
    {
      id: "q_ko_gender" as QuestionId,
      title: "성별",
      sectionId: "sec_ko" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "male" as OptionKey, label: "남자" },
        { key: "female" as OptionKey, label: "여자" },
      ],
      shuffle: false,
    },
    {
      id: "q_ko_age" as QuestionId,
      title: "연령",
      sectionId: "sec_ko" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "20s" as OptionKey, label: "20대" },
        { key: "30s" as OptionKey, label: "30대" },
        { key: "40s" as OptionKey, label: "40대" },
      ],
      shuffle: false,
    },
    {
      id: "q_ko_sat" as QuestionId,
      title: "만족도",
      sectionId: "sec_ko" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
    {
      id: "q_ko_submit" as QuestionId,
      title: "설문을 완료하시겠습니까?",
      sectionId: "sec_ko" as SectionId,
      required: true,
      affectsNavigation: true,
      kind: "single_choice",
      presentation: "radio",
      options: [{ key: "yes" as OptionKey, label: "네. 제출하겠습니다." }],
      shuffle: false,
    },
    {
      id: "q_en_gender" as QuestionId,
      title: "Gender",
      sectionId: "sec_en" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "male" as OptionKey, label: "Male" },
        { key: "female" as OptionKey, label: "Female" },
      ],
      shuffle: false,
    },
    {
      id: "q_en_age" as QuestionId,
      title: "Age",
      sectionId: "sec_en" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "single_choice",
      presentation: "radio",
      options: [
        { key: "20s" as OptionKey, label: "20s" },
        { key: "30s" as OptionKey, label: "30s" },
        { key: "40s" as OptionKey, label: "40s" },
      ],
      shuffle: false,
    },
    {
      id: "q_en_sat" as QuestionId,
      title: "Satisfaction",
      sectionId: "sec_en" as SectionId,
      required: true,
      affectsNavigation: false,
      kind: "ordinal",
      presentation: "linear_scale",
      min: 1,
      max: 5,
    },
  ],
};

// 3 original responses like the user's scenario
const originalResponses: NormalizedResponse[] = [
  {
    responseId: "orig-1" as never,
    origin: "original",
    createdAt: "2026-08-27T23:11:08+09:00",
    lastSubmittedAt: "2026-08-27T23:11:08+09:00",
    path: {
      questions: {
        q_lang: "reached",
        q_ko_gender: "reached",
        q_ko_age: "reached",
        q_ko_sat: "reached",
        q_ko_submit: "reached",
        q_en_gender: "not_reached",
        q_en_age: "not_reached",
        q_en_sat: "not_reached",
      } as never,
      confidence: "certain",
    },
    answers: {
      q_lang: { state: "answered", value: { kind: "single_choice", optionKey: "ko" as never, label: "한국어" } },
      q_ko_gender: { state: "answered", value: { kind: "single_choice", optionKey: "male" as never, label: "남자" } },
      q_ko_age: { state: "answered", value: { kind: "single_choice", optionKey: "20s" as never, label: "20대" } },
      q_ko_sat: { state: "answered", value: { kind: "ordinal", value: 5 } },
      q_ko_submit: { state: "answered", value: { kind: "single_choice", optionKey: "yes" as never, label: "네. 제출하겠습니다." } },
      q_en_gender: { state: "not_reached" },
      q_en_age: { state: "not_reached" },
      q_en_sat: { state: "not_reached" },
    },
  },
  {
    responseId: "orig-2" as never,
    origin: "original",
    createdAt: "2026-08-27T23:12:03+09:00",
    lastSubmittedAt: "2026-08-27T23:12:03+09:00",
    path: {
      questions: {
        q_lang: "reached",
        q_ko_gender: "reached",
        q_ko_age: "reached",
        q_ko_sat: "reached",
        q_ko_submit: "reached",
        q_en_gender: "not_reached",
        q_en_age: "not_reached",
        q_en_sat: "not_reached",
      } as never,
      confidence: "certain",
    },
    answers: {
      q_lang: { state: "answered", value: { kind: "single_choice", optionKey: "ko" as never, label: "한국어" } },
      q_ko_gender: { state: "answered", value: { kind: "single_choice", optionKey: "female" as never, label: "여자" } },
      q_ko_age: { state: "answered", value: { kind: "single_choice", optionKey: "40s" as never, label: "40대" } },
      q_ko_sat: { state: "answered", value: { kind: "ordinal", value: 4 } },
      q_ko_submit: { state: "answered", value: { kind: "single_choice", optionKey: "yes" as never, label: "네. 제출하겠습니다." } },
      q_en_gender: { state: "not_reached" },
      q_en_age: { state: "not_reached" },
      q_en_sat: { state: "not_reached" },
    },
  },
  {
    responseId: "orig-3" as never,
    origin: "original",
    createdAt: "2026-08-27T23:13:10+09:00",
    lastSubmittedAt: "2026-08-27T23:13:10+09:00",
    path: {
      questions: {
        q_lang: "reached",
        q_ko_gender: "not_reached",
        q_ko_age: "not_reached",
        q_ko_sat: "not_reached",
        q_ko_submit: "not_reached",
        q_en_gender: "reached",
        q_en_age: "reached",
        q_en_sat: "reached",
      } as never,
      confidence: "certain",
    },
    answers: {
      q_lang: { state: "answered", value: { kind: "single_choice", optionKey: "en" as never, label: "English" } },
      q_ko_gender: { state: "not_reached" },
      q_ko_age: { state: "not_reached" },
      q_ko_sat: { state: "not_reached" },
      q_ko_submit: { state: "not_reached" },
      q_en_gender: { state: "answered", value: { kind: "single_choice", optionKey: "male" as never, label: "Male" } },
      q_en_age: { state: "answered", value: { kind: "single_choice", optionKey: "30s" as never, label: "30s" } },
      q_en_sat: { state: "answered", value: { kind: "ordinal", value: 3 } },
    },
  },
];

describe("DAG Generative Sampler", () => {
  it("keeps distinct custom Other answers distinct in signatures", () => {
    const base = {
      q: {
        state: "answered" as const,
        value: {
          kind: "multi_choice" as const,
          optionKeys: ["other" as OptionKey],
          labels: ["custom"],
        },
      },
    };
    const custom = {
      ...base,
      q: { ...base.q, value: { ...base.q.value, otherValue: "custom" } },
    };
    expect(answerSignature(base)).not.toBe(answerSignature(custom));
  });

  it("generates 27 diverse synthetic rows with zero duplicate rows and zero duplicate timestamps", () => {
    const synthetic = generateSyntheticDataset(
      multiLanguageForm,
      originalResponses,
      27,
      42,
    );

    expect(synthetic).toHaveLength(27);

    // 1. Check all timestamps are collision-free down to the second!
    const timestamps = synthetic.map((s) => s.lastSubmittedAt);
    const uniqueTimestamps = new Set(timestamps);
    expect(uniqueTimestamps.size).toBe(27);

    // 2. Check all answer signatures have diversity (no 9 identical clones!)
    const signatures = synthetic.map((s) => answerSignature(s.answers));
    const uniqueSignatures = new Set(signatures);
    // Across 27 rows, there should be rich diversity, not 3 signatures!
    expect(uniqueSignatures.size).toBeGreaterThan(10);

    // 3. Check FormLogic DAG branching consistency:
    for (const row of synthetic) {
      const langSlot = row.answers["q_lang" as QuestionId];
      expect(langSlot?.state).toBe("answered");

      if (langSlot?.state === "answered" && langSlot.value.kind === "single_choice") {
        if (langSlot.value.optionKey === "ko") {
          // Korean chosen: Korean questions MUST be reached & answered, English MUST be not_reached
          expect(row.answers["q_ko_gender" as QuestionId]?.state).toBe("answered");
          expect(row.answers["q_ko_age" as QuestionId]?.state).toBe("answered");
          expect(row.answers["q_ko_sat" as QuestionId]?.state).toBe("answered");

          expect(row.answers["q_en_gender" as QuestionId]?.state).toBe("not_reached");
          expect(row.answers["q_en_age" as QuestionId]?.state).toBe("not_reached");
          expect(row.answers["q_en_sat" as QuestionId]?.state).toBe("not_reached");
        } else if (langSlot.value.optionKey === "en") {
          // English chosen: English questions MUST be reached & answered, Korean MUST be not_reached
          expect(row.answers["q_en_gender" as QuestionId]?.state).toBe("answered");
          expect(row.answers["q_en_age" as QuestionId]?.state).toBe("answered");
          expect(row.answers["q_en_sat" as QuestionId]?.state).toBe("answered");

          expect(row.answers["q_ko_gender" as QuestionId]?.state).toBe("not_reached");
          expect(row.answers["q_ko_age" as QuestionId]?.state).toBe("not_reached");
          expect(row.answers["q_ko_sat" as QuestionId]?.state).toBe("not_reached");
        }
      }
    }
  });

  it("generates unseen combinations via Bayesian Dirichlet smoothing", () => {
    // In originalResponses:
    // Korean male is only 20s, Korean female is only 40s.
    // 30s in Korean was NEVER chosen in original responses.
    // With Bayesian smoothing, 30s should have non-zero probability and appear across a sample!
    const synthetic = generateSyntheticDataset(
      multiLanguageForm,
      originalResponses,
      50,
      999,
    );

    const ko30s = synthetic.filter((row) => {
      const lang = row.answers["q_lang" as QuestionId];
      const age = row.answers["q_ko_age" as QuestionId];
      return (
        lang?.state === "answered" &&
        lang.value.kind === "single_choice" &&
        lang.value.optionKey === "ko" &&
        age?.state === "answered" &&
        age.value.kind === "single_choice" &&
        age.value.optionKey === "30s"
      );
    });

    // Bayesian smoothing successfully explores unobserved valid choices!
    expect(ko30s.length).toBeGreaterThan(0);
  });
});
