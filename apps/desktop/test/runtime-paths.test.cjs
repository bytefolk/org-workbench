const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { rendererEntryPath } = require("../src/runtime-paths.cjs");

test("clean renderer build lands at the Electron load target", () => {
  const desktopSourceDir = path.resolve(__dirname, "..", "src");
  const entry = rendererEntryPath(desktopSourceDir);

  assert.equal(entry, path.resolve(__dirname, "..", "dist", "renderer", "index.html"));
  assert.equal(existsSync(entry), true, `renderer entry must exist after build: ${entry}`);
});
