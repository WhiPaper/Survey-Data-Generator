import { describe, expect, it } from "vitest";

import { SynthesisJobs, type SynthesisWorker } from "../src/application/synthesis-jobs.js";

class PendingWorker implements SynthesisWorker {
  private readonly listeners = new Map<string, (value: unknown) => void>();
  public once(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown {
    this.listeners.set(event, listener);
  }
  public postMessage(): void {}
  public async terminate(): Promise<number> {
    this.listeners.get("exit")?.(1);
    return 1;
  }
}

describe("synthesis job cancellation", () => {
  it("terminates active worker and never persists a cancelled Run", async () => {
    const worker = new PendingWorker();
    const projects = {
      saveRun: () => {
        throw new Error("cancelled synthesis must not persist");
      },
    };
    const jobs = new SynthesisJobs(projects as never, () => worker);
    const pending = jobs.run(
      "job",
      "project",
      { form: {} as never, responses: [], sourceRevisionId: "revision" as never },
      { targetResponseCount: 0, questionTargets: [] },
      1,
    );
    expect(jobs.cancel("job")).toBe(true);
    await expect(pending).rejects.toMatchObject({ backendError: { code: "JOB_CANCELLED" } });
  });
});
