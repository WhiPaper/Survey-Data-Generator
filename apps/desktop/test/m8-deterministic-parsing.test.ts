import { describe, expect, it } from "vitest";

import { GoogleFormNormalizer, GoogleResponseNormalizer } from "../electron/main/forms/normalizer";

const parsingForm = {
  formId: "m8-deterministic-parsing",
  info: { title: "Deterministic parsing" },
  items: [
    {
      itemId: "score-item",
      title: "Score",
      questionItem: {
        question: {
          questionId: "score",
          scaleQuestion: { low: 1, high: 5 },
        },
      },
    },
    {
      itemId: "date-year-time-item",
      title: "Date with year and time",
      questionItem: {
        question: {
          questionId: "date-year-time",
          dateQuestion: { includeYear: true, includeTime: true },
        },
      },
    },
    {
      itemId: "date-year-item",
      title: "Date with year",
      questionItem: {
        question: {
          questionId: "date-year",
          dateQuestion: { includeYear: true, includeTime: false },
        },
      },
    },
    {
      itemId: "date-month-time-item",
      title: "Date without year with time",
      questionItem: {
        question: {
          questionId: "date-month-time",
          dateQuestion: { includeYear: false, includeTime: true },
        },
      },
    },
    {
      itemId: "date-month-item",
      title: "Date without year",
      questionItem: {
        question: {
          questionId: "date-month",
          dateQuestion: { includeYear: false, includeTime: false },
        },
      },
    },
    {
      itemId: "clock-item",
      title: "Clock",
      questionItem: {
        question: {
          questionId: "clock",
          timeQuestion: { duration: false },
        },
      },
    },
    {
      itemId: "duration-item",
      title: "Duration",
      questionItem: {
        question: {
          questionId: "duration",
          timeQuestion: { duration: true },
        },
      },
    },
  ],
};

const answer = (value: string) => ({ textAnswers: { answers: [{ value }] } });

const response = (questionId: string, value: string) => ({
  responseId: `response-${questionId}-${value}`,
  answers: { [questionId]: answer(value) },
});

describe("M8 deterministic numeric/date parsing", () => {
  const form = new GoogleFormNormalizer().normalize(
    parsingForm,
    "2026-09-06T00:00:00.000Z",
  );
  const normalizer = new GoogleResponseNormalizer();

  it("accepts only provider-canonical numeric, date, clock, and duration values", () => {
    const [normalized] = normalizer.normalizeAll(form, [
      {
        responseId: "canonical",
        answers: {
          score: answer("4"),
          "date-year-time": answer("2024-02-29 23:59"),
          "date-year": answer("2026-09-06"),
          "date-month-time": answer("02-29 09:05"),
          "date-month": answer("02-29"),
          clock: answer("09:05"),
          duration: answer("27:15"),
        },
      },
    ]);

    expect(normalized?.answers.score).toEqual({
      state: "answered",
      value: { kind: "ordinal", value: 4 },
    });
    expect(normalized?.answers["date-year-time"]).toEqual({
      state: "answered",
      value: {
        kind: "date",
        value: "2024-02-29 23:59",
        includeYear: true,
        includeTime: true,
      },
    });
    expect(normalized?.answers["date-year"]).toEqual({
      state: "answered",
      value: {
        kind: "date",
        value: "2026-09-06",
        includeYear: true,
        includeTime: false,
      },
    });
    expect(normalized?.answers["date-month-time"]).toEqual({
      state: "answered",
      value: {
        kind: "date",
        value: "02-29 09:05",
        includeYear: false,
        includeTime: true,
      },
    });
    expect(normalized?.answers["date-month"]).toEqual({
      state: "answered",
      value: {
        kind: "date",
        value: "02-29",
        includeYear: false,
        includeTime: false,
      },
    });
    expect(normalized?.answers.clock).toEqual({
      state: "answered",
      value: { kind: "time", value: "09:05", duration: false },
    });
    expect(normalized?.answers.duration).toEqual({
      state: "answered",
      value: { kind: "time", value: "27:15", duration: true },
    });
  });

  it("rejects non-decimal or out-of-range ordinal strings instead of coercing them", () => {
    for (const value of ["0x4", "4e0", "4.0", " 4 ", "6"]) {
      expect(() => normalizer.normalizeAll(form, [response("score", value)])).toThrow(
        "Google ordinal answer is invalid",
      );
    }
  });

  it("rejects malformed or impossible date and time strings without locale inference", () => {
    const invalid: Array<[string, string, string]> = [
      ["date-year-time", "2026-02-30 10:00", "Google date answer is invalid"],
      ["date-year", "2026/02/28", "Google date answer is invalid"],
      ["date-month-time", "02-29 24:00", "Google date answer is invalid"],
      ["date-month", "02-30", "Google date answer is invalid"],
      ["clock", "24:00", "Google time answer is invalid"],
      ["duration", "12:60", "Google time answer is invalid"],
    ];

    for (const [questionId, value, message] of invalid) {
      expect(() => normalizer.normalizeAll(form, [response(questionId, value)])).toThrow(message);
    }
  });
});
