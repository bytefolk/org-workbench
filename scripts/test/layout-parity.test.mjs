import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-layout-parity.mjs");

function run(mac, win) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owb-parity-"));
  const macFile = path.join(dir, "mac.json");
  const winFile = path.join(dir, "win.json");
  fs.writeFileSync(macFile, JSON.stringify(mac));
  fs.writeFileSync(winFile, JSON.stringify(win));
  return execFileSync(process.execPath, [checker, macFile, winFile], { encoding: "utf8" });
}

const layout = (over = {}) => ({
  leftWidth: 560, leftHeight: 700, rightWidth: 660, rightHeight: 700, bottomDelta: 0, ...over,
});

test("layout parity passes when both platforms agree within thresholds", () => {
  const out = run({ layout: layout() }, { layout: layout({ leftWidth: 562, rightWidth: 658 }) });
  assert.match(out, /"ok":\s*true/);
});

test("layout parity fails when a platform reports a stretched-column mismatch", () => {
  assert.throws(() => run({ layout: layout({ bottomDelta: 40 }) }, { layout: layout() }), /bottom delta/);
});

test("layout parity fails on cross-platform width drift", () => {
  assert.throws(() => run({ layout: layout() }, { layout: layout({ leftWidth: 500 }) }), /left column width/);
});

test("layout parity fails loudly when a report lacks the layout measurement", () => {
  assert.throws(() => run({ layout: null }, { layout: layout() }), /did not render/);
  assert.throws(() => run({ noLayout: true }, { layout: layout() }), /no layout measurement/);
});
