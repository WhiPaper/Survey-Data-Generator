import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const ORPHAN_TEMP_PATTERN = /\.(tmp|bak)\.[0-9a-fA-F-]{10,}$/;

export const isOrphanTempFilename = (filename: string): boolean => {
  return ORPHAN_TEMP_PATTERN.test(filename);
};

export const cleanupOrphanTempFiles = async (directories: readonly string[]): Promise<number> => {
  let cleanedCount = 0;
  for (const directory of directories) {
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && isOrphanTempFilename(entry.name)) {
        try {
          await unlink(join(directory, entry.name));
          cleanedCount += 1;
        } catch {
          // Ignore files that cannot be unlinked (e.g. locked or permissions)
        }
      }
    }
  }
  return cleanedCount;
};
