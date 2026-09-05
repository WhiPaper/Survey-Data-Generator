import { describe, expect, it, vi } from "vitest";

import { createJobRegistry } from "../electron/main/jobs";

describe("Electron job registry", () => {
  it("tracks and finishes jobs", () => {
    const jobs = createJobRegistry();
    const signal = jobs.start("job-1");

    expect(signal.aborted).toBe(false);
    expect(jobs.has("job-1")).toBe(true);

    jobs.finish("job-1");
    expect(jobs.has("job-1")).toBe(false);
  });

  it("cancels through AbortSignal and optional worker termination", () => {
    const jobs = createJobRegistry();
    const terminate = vi.fn();
    const signal = jobs.start("job-1", terminate);

    expect(jobs.cancel("job-1")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
    expect(jobs.has("job-1")).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const jobs = createJobRegistry();
    jobs.start("job-1");
    expect(() => jobs.start("job-1")).toThrow("Job already exists");
  });
});
