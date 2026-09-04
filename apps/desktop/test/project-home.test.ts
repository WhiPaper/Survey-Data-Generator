import { describe, expect, it } from "vitest";
import type { ProjectTimeline } from "@survey-synth/contracts";

import { buildTimelineData, generateTimelineData } from "../src/components/project-home";

const timelineFixture: ProjectTimeline = {
  start: "2026-08-25T00:00:00.000Z",
  end: "2026-09-01T00:00:00.000Z",
  timeZone: "Asia/Seoul",
  buckets: [
    { start: "2026-08-25T00:00:00.000Z", end: "2026-08-27T08:00:00.000Z", label: "08/25", originalCount: 1 },
    { start: "2026-08-27T08:00:00.000Z", end: "2026-08-29T16:00:00.000Z", label: "08/27", originalCount: 4 },
    { start: "2026-08-29T16:00:00.000Z", end: "2026-09-01T00:00:00.000Z", label: "08/29", originalCount: 1 },
  ],
  totalOriginalCount: 6,
  sourceTotalCount: 6,
};

describe("buildTimelineData", () => {
  it("keeps the actual source shape instead of generating a bell curve", () => {
    expect(buildTimelineData(timelineFixture, 12).map((bucket) => bucket.current)).toEqual([1, 4, 1]);
    expect(buildTimelineData(timelineFixture, 12).map((bucket) => bucket.added)).toEqual([1, 4, 1]);
  });

  it("allocates remainder additions by density instead of filling from the first bucket", () => {
    const data = buildTimelineData(timelineFixture, 11);
    expect(data.map((bucket) => bucket.added)).toEqual([1, 3, 1]);
  });
});

describe("generateTimelineData", () => {
  it("generates buckets where sum of current equals sourceCount and sum of target equals targetCount", () => {
    const startStr = "2026-08-25T00:00";
    const endStr = "2026-09-01T00:00";
    const sourceCount = 50;
    const targetCount = 200;

    const data = generateTimelineData(startStr, endStr, sourceCount, targetCount);

    expect(data.length).toBeGreaterThanOrEqual(5);
    expect(data.length).toBeLessThanOrEqual(96);

    const sumCurrent = data.reduce((sum, d) => sum + d.current, 0);
    const sumTarget = data.reduce((sum, d) => sum + d.target, 0);
    const sumAdded = data.reduce((sum, d) => sum + d.added, 0);

    expect(sumCurrent).toBe(sourceCount);
    expect(sumTarget).toBe(targetCount);
    expect(sumAdded).toBe(targetCount - sourceCount);

    for (const d of data) {
      expect(d.target).toBeGreaterThanOrEqual(d.current);
      expect(d.added).toBe(d.target - d.current);
      expect(d.target).toBe(d.current + d.added);
    }
  });

  it("handles zero additional respondents where target equals source", () => {
    const startStr = "2026-08-20T00:00";
    const endStr = "2026-08-27T00:00";
    const sourceCount = 100;
    const targetCount = 100;

    const data = generateTimelineData(startStr, endStr, sourceCount, targetCount);

    const sumCurrent = data.reduce((sum, d) => sum + d.current, 0);
    const sumTarget = data.reduce((sum, d) => sum + d.target, 0);
    const sumAdded = data.reduce((sum, d) => sum + d.added, 0);

    expect(sumCurrent).toBe(100);
    expect(sumTarget).toBe(100);
    expect(sumAdded).toBe(0);

    for (const d of data) {
      expect(d.target).toBe(d.current);
      expect(d.added).toBe(0);
    }
  });

  it("handles invalid or reversed date range by falling back to safe window", () => {
    const startStr = "invalid-date";
    const endStr = "2026-08-01T00:00";
    const sourceCount = 30;
    const targetCount = 90;

    const data = generateTimelineData(startStr, endStr, sourceCount, targetCount);

    expect(data.length).toBeGreaterThanOrEqual(5);
    const sumCurrent = data.reduce((sum, d) => sum + d.current, 0);
    const sumTarget = data.reduce((sum, d) => sum + d.target, 0);

    expect(sumCurrent).toBe(sourceCount);
    expect(sumTarget).toBe(targetCount);
  });

  it("includes hours in label when range is 2 days or less", () => {
    const startStr = "2026-09-01T09:00";
    const endStr = "2026-09-02T18:00";
    const sourceCount = 40;
    const targetCount = 80;

    const data = generateTimelineData(startStr, endStr, sourceCount, targetCount);

    expect(data[0]?.timestamp).toMatch(/\d{2}\/\d{2} \d{2}:00/);
  });
});
