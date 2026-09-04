import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  StableReadError,
  readStableBoundedFile,
} from "../src/stable-read.js";
import type {
  StableReadOperations,
} from "../src/stable-read.js";

function nodeOperations(options: {
  onOpenFlags?: (flags: number) => void;
  afterFirstRead?: (file: string) => Promise<void>;
} = {}): StableReadOperations {
  return {
    async open(file, flags) {
      options.onOpenFlags?.(flags);
      const handle = await fs.open(file, flags);
      let firstRead = true;
      return {
        stat: () => handle.stat({ bigint: true }),
        async read(buffer, offset, length, position) {
          const { bytesRead } = await handle.read(buffer, offset, length, position);
          if (firstRead && bytesRead > 0) {
            firstRead = false;
            await options.afterFirstRead?.(file);
          }
          return bytesRead;
        },
        close: () => handle.close(),
      };
    },
    lstat: (file) => fs.lstat(file, { bigint: true }),
  };
}

test("stable read reports actual UTF-8 bytes and uses no-follow non-blocking flags (#112)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-stable-read-"));
  const file = path.join(dir, "record.json");
  const payload = `${JSON.stringify({ value: "你好" })}\n`;
  let openedFlags = -1;
  try {
    await fs.writeFile(file, payload, { mode: 0o600 });
    const result = await readStableBoundedFile(file, 1024, nodeOperations({
      onOpenFlags: (flags) => { openedFlags = flags; },
    }));
    assert.equal(result.buffer.toString("utf8"), payload);
    assert.equal(result.bytes, Buffer.byteLength(payload, "utf8"));
    assert.equal(openedFlags & fsConstants.O_WRONLY, 0);
    assert.equal(openedFlags & fsConstants.O_RDWR, 0);
    if ((fsConstants.O_NOFOLLOW ?? 0) !== 0) {
      assert.equal(openedFlags & fsConstants.O_NOFOLLOW, fsConstants.O_NOFOLLOW);
    }
    if (process.platform !== "win32" && (fsConstants.O_NONBLOCK ?? 0) !== 0) {
      assert.equal(openedFlags & fsConstants.O_NONBLOCK, fsConstants.O_NONBLOCK);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stable read rejects a pathname swapped after the handle read (#112)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-stable-swap-"));
  const file = path.join(dir, "record.json");
  const replacement = path.join(dir, "replacement.json");
  try {
    await fs.writeFile(file, "{\"first\":true}\n", { mode: 0o600 });
    await assert.rejects(
      readStableBoundedFile(file, 1024, nodeOperations({
        afterFirstRead: async () => {
          await fs.writeFile(replacement, "{\"other\":true}\n", { mode: 0o600 });
          await fs.rename(replacement, file);
        },
      })),
      StableReadError,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stable read rejects in-place size changes during the positional read (#112)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-stable-grow-"));
  const file = path.join(dir, "record.json");
  try {
    await fs.writeFile(file, "{}\n", { mode: 0o600 });
    await assert.rejects(
      readStableBoundedFile(file, 1024, nodeOperations({
        afterFirstRead: async () => { await fs.appendFile(file, " "); },
      })),
      StableReadError,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
