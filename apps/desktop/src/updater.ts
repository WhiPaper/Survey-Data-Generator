export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_UPDATE_CHECK_KEY = "survey-synth:last-update-check";

export interface InstallableUpdate {
  readonly version: string;
  download(): Promise<void>;
  install(): Promise<void>;
}

export interface UpdateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const checkOnceDaily = async <T extends InstallableUpdate>(
  check: () => Promise<T | null>,
  storage: UpdateStorage,
  now = Date.now(),
): Promise<T | null> => {
  const stored = storage.getItem(LAST_UPDATE_CHECK_KEY);
  const previous = stored === null ? Number.NaN : Number(stored);
  if (Number.isFinite(previous) && now - previous < UPDATE_CHECK_INTERVAL_MS) return null;
  storage.setItem(LAST_UPDATE_CHECK_KEY, String(now));
  return check();
};
