import { describe, expect, it } from "vitest";
import type { NormalizedResponse } from "@survey-synth/domain";
import {
  detectTemporalWindow,
  generateSyntheticTimestamps,
} from "../src/generative/temporal-sampler.js";

describe("Temporal Sampler", () => {
  it("detects temporal window and preserves timezone offset", () => {
    const rows: NormalizedResponse[] = [
      {
        responseId: "r1" as never,
        origin: "original",
        createdAt: "2026-08-27T23:11:08+09:00",
        lastSubmittedAt: "2026-08-27T23:11:08+09:00",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      },
      {
        responseId: "r2" as never,
        origin: "original",
        createdAt: "2026-08-27T23:12:03+09:00",
        lastSubmittedAt: "2026-08-27T23:12:03+09:00",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      },
      {
        responseId: "r3" as never,
        origin: "original",
        createdAt: "2026-08-27T23:13:10+09:00",
        lastSubmittedAt: "2026-08-27T23:13:10+09:00",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      },
    ];

    const window = detectTemporalWindow(rows);
    expect(window.offsetString).toBe("+09:00");
    expect(window.endMs).toBeGreaterThan(window.startMs);
  });

  it("generates collision-free timestamps down to the second", () => {
    const window = {
      startMs: Date.parse("2026-08-27T10:00:00+09:00"),
      endMs: Date.parse("2026-08-29T22:00:00+09:00"),
      offsetString: "+09:00",
    };

    const count = 50;
    const timestamps = generateSyntheticTimestamps(count, window, 42);
    expect(timestamps).toHaveLength(count);

    const submitTimes = timestamps.map((t) => t.lastSubmittedAt);
    const uniqueSubmitTimes = new Set(submitTimes);

    // ZERO collisions!
    expect(uniqueSubmitTimes.size).toBe(count);

    // Chronological order
    for (let i = 1; i < timestamps.length; i += 1) {
      const prev = Date.parse(timestamps[i - 1]!.lastSubmittedAt);
      const curr = Date.parse(timestamps[i]!.lastSubmittedAt);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }

    // Correct offset preserved
    for (const t of timestamps) {
      expect(t.lastSubmittedAt.endsWith("+09:00")).toBe(true);
      expect(t.createdAt.endsWith("+09:00")).toBe(true);
    }
  });

  it("produces deterministic output for the same seed", () => {
    const window = {
      startMs: Date.parse("2026-08-27T10:00:00+09:00"),
      endMs: Date.parse("2026-08-29T22:00:00+09:00"),
      offsetString: "+09:00",
    };

    const run1 = generateSyntheticTimestamps(20, window, 123);
    const run2 = generateSyntheticTimestamps(20, window, 123);
    const run3 = generateSyntheticTimestamps(20, window, 456);

    expect(run1).toEqual(run2);
    expect(run1).not.toEqual(run3);
  });

  it("follows clustered source timestamp density", () => {
    const clusteredRows: NormalizedResponse[] = Array.from({ length: 8 }, (_, index) => ({
      responseId: `morning-${index}` as never,
      origin: "original",
      lastSubmittedAt: "2026-08-27T10:00:00+09:00",
      path: { questions: {}, confidence: "certain" },
      answers: {},
    }));
    clusteredRows.push(
      ...Array.from({ length: 2 }, (_, index) => ({
        responseId: `evening-${index}` as never,
        origin: "original",
        lastSubmittedAt: "2026-08-27T20:00:00+09:00",
        path: { questions: {}, confidence: "certain" },
        answers: {},
      })),
    );

    const window = detectTemporalWindow(clusteredRows);
    const timestamps = generateSyntheticTimestamps(100, window, 7);
    const morning = timestamps.filter((timestamp) => {
      const hour = new Date(timestamp.lastSubmittedAt).getHours();
      return hour >= 9 && hour <= 11;
    }).length;
    const evening = timestamps.filter((timestamp) => {
      const hour = new Date(timestamp.lastSubmittedAt).getHours();
      return hour >= 19 && hour <= 21;
    }).length;

    expect(morning).toBeGreaterThan(evening);
    expect(morning).toBeGreaterThan(50);
  });
});
