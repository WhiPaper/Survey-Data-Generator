import { describe, expect, it, vi } from "vitest";

import { UPDATE_CHECK_INTERVAL_MS, checkOnceDaily } from "../src/updater";

describe("checkOnceDaily", () => {
  it("checks once per day and persists its nonblocking cadence", async () => {
    const storage = new Map<string, string>();
    const check = vi.fn().mockResolvedValue(null);
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };

    await checkOnceDaily(check, adapter, 1_000);
    await checkOnceDaily(check, adapter, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1);
    await checkOnceDaily(check, adapter, 1_000 + UPDATE_CHECK_INTERVAL_MS);

    expect(check).toHaveBeenCalledTimes(2);
  });
});
