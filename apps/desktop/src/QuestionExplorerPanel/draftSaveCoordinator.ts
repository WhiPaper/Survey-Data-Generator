import type { TargetDraft } from "@survey-synth/contracts";

type SaveTargetDraft = (draft: TargetDraft) => Promise<unknown>;

const serializeDraft = (draft: TargetDraft): string => JSON.stringify(draft);

export const createDraftSaveCoordinator = (save: SaveTargetDraft) => {
  let latestDraft: TargetDraft | null = null;
  let latestSerialized: string | null = null;
  let persistedSerialized: string | null = null;
  let activeFlush: Promise<void> | null = null;

  const setLatest = (draft: TargetDraft, persisted = false): void => {
    latestDraft = draft;
    latestSerialized = serializeDraft(draft);
    if (persisted) persistedSerialized = latestSerialized;
  };

  const runFlush = async (): Promise<void> => {
    while (latestDraft && latestSerialized !== persistedSerialized) {
      const draftToSave = latestDraft;
      const serializedToSave = latestSerialized;
      await save(draftToSave);
      persistedSerialized = serializedToSave;
    }
  };

  const flush = (): Promise<void> => {
    if (activeFlush) {
      return activeFlush.then(() =>
        latestSerialized === persistedSerialized ? undefined : flush(),
      );
    }
    const task = runFlush();
    activeFlush = task;
    return task.finally(() => {
      if (activeFlush === task) activeFlush = null;
    });
  };

  return {
    setLatest,
    flush,
    hasPending: (): boolean => latestDraft !== null && latestSerialized !== persistedSerialized,
  } as const;
};
