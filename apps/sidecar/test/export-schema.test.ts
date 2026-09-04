import { describe, expect, it } from "vitest";
import type {
  FormSnapshot,
  NormalizedResponse,
  Question,
  QuestionGroup,
} from "@survey-synth/domain";
import { compileExportSchema, formatTimestampInTimezone } from "../src/export/schema.js";

const makeMockForm = (overrides?: Partial<FormSnapshot>): FormSnapshot => {
  const defaultQuestions: Question[] = [
    {
      id: "q_satisfaction_1" as never,
      title: "만족도",
      kind: "ordinal",
      scale: { min: 1, max: 5 },
    },
    {
      id: "q_satisfaction_2" as never,
      title: "만족도",
      kind: "ordinal",
      scale: { min: 1, max: 5 },
    },
    {
      id: "q_channels" as never,
      title: "방문 경로",
      kind: "multi_choice",
      options: [
        { key: "opt_search" as never, label: "포털 검색" },
        { key: "opt_sns" as never, label: "SNS 광고" },
        { key: "opt_referral" as never, label: "지인 추천" },
      ],
    },
    {
      id: "q_code" as never,
      title: "고객번호",
      kind: "text",
      textType: "short",
    },
    {
      id: "q_age" as never,
      title: "나이",
      kind: "text",
      textType: "short",
    },
    {
      id: "q_birthdate" as never,
      title: "생년월일",
      kind: "date",
      includeYear: true,
      includeTime: false,
    },
    {
      id: "q_anniversary" as never,
      title: "기념일",
      kind: "date",
      includeYear: false,
      includeTime: false,
    },
  ];

  return {
    formId: "form_123" as never,
    title: "고객 만족도 조사",
    revision: 1,
    capturedAt: "2026-09-01T00:00:00Z",
    schemaHash: "hash123",
    groups: [],
    questions: defaultQuestions,
    ...overrides,
  };
};

describe("ExportSchema compiler", () => {
  it("compiles column headers with timestamp first, grid flattening, and minimal disambiguation", () => {
    const group: QuestionGroup = {
      id: "grp_service" as never,
      title: "서비스 평가",
      kind: "grid",
      questionIds: ["q_grid_speed" as never, "q_grid_kindness" as never],
    };

    const form = makeMockForm({
      groups: [group],
      questions: [
        {
          id: "q_grid_speed" as never,
          groupId: group.id,
          title: "처리 속도",
          kind: "ordinal",
          scale: { min: 1, max: 5 },
        },
        {
          id: "q_grid_kindness" as never,
          groupId: group.id,
          title: "친절도",
          kind: "ordinal",
          scale: { min: 1, max: 5 },
        },
        {
          id: "q_dup_1" as never,
          title: "재방문 의향",
          kind: "single_choice",
          options: [{ key: "o1" as never, label: "예" }],
        },
        {
          id: "q_dup_2" as never,
          title: "재방문 의향",
          kind: "single_choice",
          options: [{ key: "o2" as never, label: "예" }],
        },
        {
          id: "q_dup_3" as never,
          title: "재방문 의향",
          kind: "single_choice",
          options: [{ key: "o3" as never, label: "예" }],
        },
      ],
    });

    const schema = compileExportSchema({
      form,
      originalResponses: [],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
    });

    const headers = schema.columns.map((c) => c.header);
    expect(headers).toEqual([
      "Response Timestamp",
      "서비스 평가 [처리 속도]",
      "서비스 평가 [친절도]",
      "재방문 의향",
      "재방문 의향 (2)",
      "재방문 의향 (3)",
    ]);

    expect(headers).not.toContain("internalRowKey");
    expect(headers).not.toContain("responseId");
  });

  it("keeps duplicate titles unique when a title already contains a numeric suffix", () => {
    const form = makeMockForm({
      questions: [
        { id: "q1" as never, title: "만족도", kind: "ordinal", scale: { min: 1, max: 5 } },
        { id: "q2" as never, title: "만족도", kind: "ordinal", scale: { min: 1, max: 5 } },
        { id: "q3" as never, title: "만족도 (2)", kind: "ordinal", scale: { min: 1, max: 5 } },
      ],
    });

    const schema = compileExportSchema({
      form,
      originalResponses: [],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
    });

    expect(schema.columns.map((column) => column.header)).toEqual([
      "Response Timestamp",
      "만족도",
      "만족도 (2)",
      "만족도 (3)",
    ]);
  });

  it("also disambiguates a question title that collides with the timestamp header", () => {
    const form = makeMockForm({
      questions: [
        { id: "q1" as never, title: "Response Timestamp", kind: "text", textType: "short" },
        { id: "q2" as never, title: "Response Timestamp", kind: "text", textType: "short" },
      ],
    });

    const schema = compileExportSchema({
      form,
      originalResponses: [],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
    });

    expect(schema.columns.map((column) => column.header)).toEqual([
      "Response Timestamp",
      "Response Timestamp (2)",
      "Response Timestamp (3)",
    ]);
  });

  it("maps answer slot kinds correctly: ordinal, multichoice order, leading zeros, dates", () => {
    const form = makeMockForm();
    const original: NormalizedResponse = {
      responseId: "resp_orig_1" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {
        q_satisfaction_1: {
          state: "answered",
          value: { kind: "ordinal", value: 5 },
        },
        q_satisfaction_2: {
          state: "skipped",
        },
        q_channels: {
          state: "answered",
          value: {
            kind: "multi_choice",
            optionKeys: ["opt_referral" as never, "opt_search" as never],
            labels: ["지인 추천", "포털 검색"],
          },
        },
        q_code: {
          state: "answered",
          value: { kind: "text", value: "00123" },
        },
        q_age: {
          state: "answered",
          value: { kind: "text", value: "35" },
        },
        q_birthdate: {
          state: "answered",
          value: {
            kind: "date",
            value: "1990-05-15",
            includeYear: true,
            includeTime: false,
          },
        },
        q_anniversary: {
          state: "answered",
          value: {
            kind: "date",
            value: "05-15",
            includeYear: false,
            includeTime: false,
          },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const schema = compileExportSchema({
      form,
      originalResponses: [original],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
      semanticOverrides: [
        { questionId: "q_code" as never, value: "numeric", updatedAt: "" },
        { questionId: "q_age" as never, value: "numeric", updatedAt: "" },
      ],
    });

    const rows = Array.from(schema.getRows());
    expect(rows).toHaveLength(1);
    const cells = rows[0]!;

    expect(cells[0]?.kind).toBe("datetime");
    expect(cells[1]).toEqual({ kind: "number", value: 5 });
    expect(cells[2]).toEqual({ kind: "empty" });
    expect(cells[3]).toEqual({ kind: "text", value: "포털 검색, 지인 추천" });
    expect(cells[4]).toEqual({ kind: "text", value: "00123" });
    expect(cells[5]).toEqual({ kind: "number", value: 35 });
    expect(cells[6]).toEqual({
      kind: "date",
      year: 1990,
      month: 5,
      day: 15,
      formatted: "1990-05-15",
    });
    expect(cells[7]).toEqual({ kind: "text", value: "05-15" });
  });

  it("preserves duplicate option labels in historical option order", () => {
    const form = makeMockForm({
      questions: [
        {
          id: "q_multi" as never,
          title: "선택",
          kind: "multi_choice",
          options: [
            { key: "a" as never, label: "같음" },
            { key: "b" as never, label: "같음" },
            { key: "c" as never, label: "다름" },
          ],
        },
      ],
    });
    const response: NormalizedResponse = {
      responseId: "response" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {
        q_multi: {
          state: "answered",
          value: {
            kind: "multi_choice",
            optionKeys: ["c" as never, "a" as never, "b" as never],
            labels: ["다름", "같음", "같음"],
          },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const rows = Array.from(
      compileExportSchema({
        form,
        originalResponses: [response],
        syntheticResponses: [],
        timeZone: "Asia/Seoul",
      }).getRows(),
    );
    expect(rows[0]?.[1]).toEqual({ kind: "text", value: "같음, 같음, 다름" });
  });

  it("types time-of-day and duration values without losing their semantics", () => {
    const form = makeMockForm({
      questions: [
        { id: "q_time" as never, title: "시각", kind: "time", duration: false },
        { id: "q_duration" as never, title: "소요 시간", kind: "time", duration: true },
      ],
    });
    const response: NormalizedResponse = {
      responseId: "response" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {
        q_time: { state: "answered", value: { kind: "time", value: "14:30", duration: false } },
        q_duration: {
          state: "answered",
          value: { kind: "time", value: "1:45", duration: true },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const rows = Array.from(
      compileExportSchema({
        form,
        originalResponses: [response],
        syntheticResponses: [],
        timeZone: "Asia/Seoul",
      }).getRows(),
    );
    expect(rows[0]?.[1]).toEqual({
      kind: "time",
      value: "14:30",
      seconds: 52_200,
      duration: false,
    });
    expect(rows[0]?.[2]).toEqual({
      kind: "time",
      value: "01:45:00",
      seconds: 6_300,
      duration: true,
    });
  });

  it("uses frozen inferred semantics unless a historical override replaces them", () => {
    const form = makeMockForm({
      questions: [{ id: "q_age" as never, title: "나이", kind: "text", textType: "short" }],
    });
    const response: NormalizedResponse = {
      responseId: "response" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {
        q_age: { state: "answered", value: { kind: "text", value: "35" } },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const inferred = compileExportSchema({
      form,
      originalResponses: [response],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
      semanticInferences: [{ questionId: "q_age" as never, value: "numeric" }],
    });
    expect(Array.from(inferred.getRows())[0]?.[1]).toEqual({ kind: "number", value: 35 });

    const overridden = compileExportSchema({
      form,
      originalResponses: [response],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
      semanticInferences: [{ questionId: "q_age" as never, value: "numeric" }],
      semanticOverrides: [{ questionId: "q_age" as never, value: "text", updatedAt: "now" }],
    });
    expect(Array.from(overridden.getRows())[0]?.[1]).toEqual({ kind: "text", value: "35" });
  });

  it("sorts rows by timestamp ascending with deterministic tie-breaking", () => {
    const form = makeMockForm();
    const orig1: NormalizedResponse = {
      responseId: "orig_b" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {},
      path: { visitedQuestionIds: [], status: "complete" },
    };
    const orig2: NormalizedResponse = {
      responseId: "orig_a" as never,
      createdAt: "2026-09-02T09:00:00Z",
      origin: "original",
      answers: {},
      path: { visitedQuestionIds: [], status: "complete" },
    };
    const synth1: NormalizedResponse = {
      responseId: "synth_1" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "synthetic",
      answers: {},
      path: { visitedQuestionIds: [], status: "complete" },
    };
    const synth2: NormalizedResponse = {
      responseId: "synth_0" as never,
      createdAt: "2026-09-02T11:00:00Z",
      origin: "synthetic",
      answers: {},
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const schema = compileExportSchema({
      form,
      originalResponses: [orig1, orig2],
      syntheticResponses: [synth1, synth2],
      timeZone: "Asia/Seoul",
    });

    const rows = Array.from(schema.getRows());
    expect(rows).toHaveLength(4);

    const times = rows.map((r) => {
      const cell = r[0]!;
      return cell.kind === "datetime" ? cell.isoWithOffset : "";
    });

    expect(times[0]).toContain("18:00:00");
    expect(times[1]).toContain("19:00:00");
    expect(times[2]).toContain("19:00:00");
    expect(times[3]).toContain("20:00:00");
  });

  it("uses response IDs for original ties and persisted order for synthetic ties", () => {
    const form = makeMockForm({
      questions: [{ id: "q_value" as never, title: "값", kind: "text", textType: "short" }],
    });
    const response = (id: string, origin: "original" | "synthetic"): NormalizedResponse => ({
      responseId: id as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin,
      answers: { q_value: { state: "answered", value: { kind: "text", value: id } } },
      path: { visitedQuestionIds: [], status: "complete" },
    });
    const rows = Array.from(
      compileExportSchema({
        form,
        originalResponses: [response("orig-b", "original"), response("orig-a", "original")],
        syntheticResponses: [response("synth-b", "synthetic"), response("synth-a", "synthetic")],
        timeZone: "UTC",
      }).getRows(),
    );

    expect(rows.map((row) => (row[1]?.kind === "text" ? row[1].value : ""))).toEqual([
      "orig-a",
      "orig-b",
      "synth-b",
      "synth-a",
    ]);
  });

  it("exports a custom checkbox Other value without losing the selected option", () => {
    const form = makeMockForm({
      questions: [
        {
          id: "q_channels" as never,
          title: "방문 경로",
          kind: "multi_choice",
          options: [
            { key: "opt_search" as never, label: "포털 검색" },
            { key: "opt_other" as never, label: "Other", isOther: true },
          ],
        },
      ],
    });
    const original: NormalizedResponse = {
      responseId: "resp_other" as never,
      createdAt: "2026-09-02T10:00:00Z",
      origin: "original",
      answers: {
        q_channels: {
          state: "answered",
          value: {
            kind: "multi_choice",
            optionKeys: ["opt_other" as never],
            labels: ["직접 입력"],
            otherValue: "직접 입력",
          },
        },
      },
      path: { visitedQuestionIds: [], status: "complete" },
    };

    const schema = compileExportSchema({
      form,
      originalResponses: [original],
      syntheticResponses: [],
      timeZone: "Asia/Seoul",
    });

    expect(Array.from(schema.getRows())[0]?.[1]).toEqual({
      kind: "text",
      value: "직접 입력",
    });
  });

  it("formats timestamp in project timezone consistently", () => {
    const formatted = formatTimestampInTimezone("2026-09-02T10:00:00Z", "Asia/Seoul");
    expect(formatted.isoWithOffset).toBe("2026-09-02T19:00:00+09:00");
    expect(formatted.date.toISOString()).toBe("2026-09-02T19:00:00.000Z");

    const formattedUtc = formatTimestampInTimezone("2026-09-02T10:00:00Z", "UTC");
    expect(formattedUtc.isoWithOffset).toBe("2026-09-02T10:00:00+00:00");
  });
});
