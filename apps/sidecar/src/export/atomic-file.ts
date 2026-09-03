import { createWriteStream, type WriteStream } from "node:fs";
import { open, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export interface AtomicFileWriter {
  readonly tempPath: string;
  readonly destination: string;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface AtomicStreamWriter extends AtomicFileWriter {
  readonly stream: WriteStream;
}

const safeUnlink = async (path: string): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(path);
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") return;
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }
};

const safeAtomicReplace = async (tempPath: string, destination: string): Promise<void> => {
  try {
    await rename(tempPath, destination);
  } catch (_error) {
    const backupPath = `${destination}.bak.${randomUUID()}`;
    let backupCreated = false;
    try {
      const destExists = await stat(destination)
        .then(() => true)
        .catch(() => false);
      if (destExists) {
        await rename(destination, backupPath);
        backupCreated = true;
      }
      await rename(tempPath, destination);
      if (backupCreated) {
        await safeUnlink(backupPath);
      }
    } catch (innerError) {
      if (backupCreated) {
        try {
          await rename(backupPath, destination);
        } catch {
          // preserve backup
        }
      }
      throw innerError;
    }
  }
};

const syncFile = async (path: string): Promise<void> => {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const createAtomicFile = async (destination: string): Promise<AtomicFileWriter> => {
  await mkdir(dirname(destination), { recursive: true });
  const tempPath = `${destination}.tmp.${randomUUID()}`;
  let completed = false;

  const commit = async (): Promise<void> => {
    if (completed) return;
    completed = true;
    try {
      await syncFile(tempPath);
      await safeAtomicReplace(tempPath, destination);
    } catch (error) {
      await safeUnlink(tempPath);
      throw error;
    }
  };

  const abort = async (): Promise<void> => {
    if (completed) return;
    completed = true;
    await safeUnlink(tempPath);
  };

  return { tempPath, destination, commit, abort };
};

export const createAtomicStream = async (destination: string): Promise<AtomicStreamWriter> => {
  const atomic = await createAtomicFile(destination);
  const stream = createWriteStream(atomic.tempPath);
  let streamClosed = false;

  const closeStream = async (): Promise<void> => {
    if (streamClosed) return;
    if (stream.closed || stream.destroyed) {
      streamClosed = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        stream.off("close", onClose);
        stream.off("error", onError);
      };
      const onClose = (): void => {
        cleanup();
        streamClosed = true;
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      stream.once("close", onClose);
      stream.once("error", onError);
      try {
        stream.end((error?: Error | null) => {
          if (error !== undefined && error !== null) onError(error);
        });
      } catch (error) {
        onError(error instanceof Error ? error : new Error("Atomic stream could not close"));
      }
    });
  };

  const commit = async (): Promise<void> => {
    await closeStream();
    await atomic.commit();
  };

  const abort = async (): Promise<void> => {
    try {
      if (!stream.closed && !stream.destroyed) {
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            stream.off("close", finish);
            stream.off("error", finish);
            resolve();
          };
          stream.once("close", finish);
          stream.once("error", finish);
          stream.destroy();
        });
      }
    } finally {
      await atomic.abort();
    }
  };

  return {
    tempPath: atomic.tempPath,
    destination: atomic.destination,
    stream,
    commit,
    abort,
  };
};
