import { describe, expect, it } from "vitest";

import type { TargetDraft } from "@survey-synth/contracts";
import { createDraftSaveCoordinator } from "../src/QuestionExplorerPanel/draftSaveCoordinator";

const draft = (finalCount: number): TargetDraft => ({
  projectId: "project-1",
  finalCount,
  sourceScope: { kind: "all" },
  seed: 42,
  targets: [],
});

describe("Question Explorer draft save coordinator", () => {
  it("skips a flush when the latest draft is already persisted", async () => {
    const saves: TargetDraft[] = [];
    const coordinator = createDraftSaveCoordinator(async (value) => {
      saves.push(value);
    });
    coordinator.setLatest(draft(120), true);
    await coordinator.flush();
    expect(saves).toEqual([]);

    coordinator.setLatest(draft(121));
    await coordinator.flush();
    await coordinator.flush();
    expect(saves.map((value) => value.finalCount)).toEqual([121]);
  });

  it("continues to the newest draft when it changes during an active save", async () => {
    const saves: number[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const coordinator = createDraftSaveCoordinator(async (value) => {
      saves.push(value.finalCount ?? 0);
      if (saves.length === 1) await firstSave;
    });

    coordinator.setLatest(draft(120));
    const flushing = coordinator.flush();
    await Promise.resolve();
    coordinator.setLatest(draft(121));
    releaseFirst?.();
    await flushing;

    expect(saves).toEqual([120, 121]);
    expect(coordinator.hasPending()).toBe(false);
  });

  it("keeps a failed draft pending so a later flush can retry it", async () => {
    let attempts = 0;
    const coordinator = createDraftSaveCoordinator(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("save failed");
    });
    coordinator.setLatest(draft(120));

    await expect(coordinator.flush()).rejects.toThrow("save failed");
    expect(coordinator.hasPending()).toBe(true);
    await coordinator.flush();
    expect(attempts).toBe(2);
    expect(coordinator.hasPending()).toBe(false);
  });
});
