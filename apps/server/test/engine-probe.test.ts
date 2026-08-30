import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { probeEngine, splitCommand } from "../src/engine/probe.js";

// #78 REQ-001 — splitCommand must survive absolute paths containing spaces
// (Windows default installs under `C:\Program Files\...`, macOS OneDrive
// folders, Linux `~/My Projects/...`). It must remain bit-for-bit compatible
// with the previous whitespace-only behaviour when no quoting is present.

test("splitCommand keeps the naive whitespace split when no quoting is present", () => {
  const { bin, prefix } = splitCommand("node /repo/bin.js --flag value");
  assert.equal(bin, "node");
  assert.deepEqual(prefix, ["/repo/bin.js", "--flag", "value"]);
});

test("splitCommand preserves a double-quoted Windows path that contains spaces", () => {
  const command = '"C:\\Program Files\\Node\\node.exe" "C:\\my path\\bin.js" --flag';
  const { bin, prefix } = splitCommand(command);
  assert.equal(bin, "C:\\Program Files\\Node\\node.exe");
  assert.deepEqual(prefix, ["C:\\my path\\bin.js", "--flag"]);
});

test("splitCommand preserves a POSIX path with spaces inside single quotes", () => {
  const { bin, prefix } = splitCommand("/usr/local/bin/node '/home/me/My Projects/bin.js'");
  assert.equal(bin, "/usr/local/bin/node");
  assert.deepEqual(prefix, ["/home/me/My Projects/bin.js"]);
});

test("splitCommand honours backslash-escaped quotes inside a double-quoted token", () => {
  const { bin, prefix } = splitCommand('node "quote-\\"in\\"-token"');
  assert.equal(bin, "node");
  assert.deepEqual(prefix, ['quote-"in"-token']);
});

test("splitCommand collapses runs of whitespace and empty commands stay stable", () => {
  const collapsed = splitCommand("node    bin.js");
  assert.equal(collapsed.bin, "node");
  assert.deepEqual(collapsed.prefix, ["bin.js"]);
  const empty = splitCommand("");
  assert.equal(empty.bin, "");
  assert.deepEqual(empty.prefix, []);
});

// #78 REQ-002 — probeEngine's nextStep must distinguish the three failure
// modes an operator sees (OS refused to launch, spawned but broken, timed out)
// so a "not reachable" message no longer collapses "the file does not exist"
// with "the CLI crashed".

test("probeEngine flags an OS-side launch failure with an ENOENT explanation", async () => {
  const command = "/tmp/definitely-not-a-binary-8973b2bd";
  const probe = await probeEngine(command, 500);
  assert.equal(probe.available, false);
  assert.ok(probe.nextStep);
  assert.ok(
    probe.nextStep!.includes("ENOENT"),
    `expected ENOENT hint, got: ${probe.nextStep}`,
  );
});

test("probeEngine reports the spawn-then-broken case distinctly from ENOENT", async () => {
  if (process.platform === "win32") return; // POSIX shim is enough evidence
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-probe-"));
  const shim = path.join(root, "broken-cli.sh");
  await fs.writeFile(shim, "#!/bin/sh\necho unusable output >&2\nexit 3\n", { mode: 0o755 });
  try {
    const probe = await probeEngine(shim, 1000);
    assert.equal(probe.available, false);
    assert.ok(probe.nextStep);
    assert.ok(
      !probe.nextStep!.includes("ENOENT"),
      `unexpected ENOENT hint for a broken-but-launched binary: ${probe.nextStep}`,
    );
    assert.ok(
      /non-zero|did not respond/.test(probe.nextStep!),
      `expected a launched-but-broken hint, got: ${probe.nextStep}`,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
