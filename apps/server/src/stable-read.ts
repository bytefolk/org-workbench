import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import { TextDecoder } from "node:util";

export interface StableReadHandle {
  stat(): Promise<BigIntStats>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<number>;
  close(): Promise<void>;
}

export interface StableReadOperations {
  open(file: string, flags: number): Promise<StableReadHandle>;
  lstat(file: string): Promise<BigIntStats>;
}

export interface StableBoundedRead {
  buffer: Buffer;
  bytes: number;
}

export class StableReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StableReadError";
  }
}

export function decodeStableUtf8(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new StableReadError("state record is not valid UTF-8");
  }
}

const nodeStableReadOperations: StableReadOperations = {
  async open(file, flags) {
    const handle = await fs.open(file, flags);
    return {
      stat: () => handle.stat({ bigint: true }),
      read: async (buffer, offset, length, position) =>
        (await handle.read(buffer, offset, length, position)).bytesRead,
      close: () => handle.close(),
    };
  },
  lstat: (file) => fs.lstat(file, { bigint: true }),
};

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertBoundedRegularFile(stat: BigIntStats, maxBytes: number): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 0n ||
    stat.size > BigInt(maxBytes)
  ) {
    throw new StableReadError("state record is not a bounded regular file");
  }
}

function openFlags(): number {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const nonBlocking = process.platform === "win32" ? 0 : (fsConstants.O_NONBLOCK ?? 0);
  return fsConstants.O_RDONLY | noFollow | nonBlocking;
}

/**
 * Opens one pathname without following symlinks, binds it to a stable inode,
 * and performs a fixed max+1 positional read. Callers receive the actual
 * stable byte count rather than a pre-read pathname estimate.
 */
export async function readStableBoundedFile(
  file: string,
  maxBytes: number,
  operations: StableReadOperations = nodeStableReadOperations,
): Promise<StableBoundedRead> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }

  let handle: StableReadHandle;
  try {
    handle = await operations.open(file, openFlags());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new StableReadError("state record could not be opened safely");
  }

  try {
    const opened = await handle.stat();
    const namedBefore = await operations.lstat(file);
    assertBoundedRegularFile(opened, maxBytes);
    assertBoundedRegularFile(namedBefore, maxBytes);
    if (!sameSnapshot(opened, namedBefore)) {
      throw new StableReadError("state record identity changed while opening");
    }

    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const bytesRead = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - bytes) {
        throw new StableReadError("state record returned an invalid read length");
      }
      if (bytesRead === 0) break;
      bytes += bytesRead;
    }
    if (bytes > maxBytes) {
      throw new StableReadError("state record exceeds its bounded size");
    }

    const openedAfter = await handle.stat();
    const namedAfter = await operations.lstat(file);
    assertBoundedRegularFile(openedAfter, maxBytes);
    assertBoundedRegularFile(namedAfter, maxBytes);
    if (
      !sameSnapshot(opened, openedAfter) ||
      !sameSnapshot(opened, namedAfter) ||
      BigInt(bytes) !== opened.size
    ) {
      throw new StableReadError("state record changed during its bounded read");
    }
    return { buffer: buffer.subarray(0, bytes), bytes };
  } catch (error) {
    if (error instanceof StableReadError) throw error;
    throw new StableReadError("state record could not be read stably");
  } finally {
    await handle.close().catch(() => undefined);
  }
}
