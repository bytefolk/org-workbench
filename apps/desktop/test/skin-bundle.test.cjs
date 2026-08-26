// #50 regression: a stray `*/` inside the antd-skin.css header comment closed the
// comment early, and the CSS parser dropped the whole light-theme :root token block
// (caught by CDP computed-value audit, invisible to static checks). Assert the
// DS-31-001 token values survive parsing in the built renderer bundle.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("renderer bundle keeps the DS-31-001 light skin token block (#50)", () => {
  const assetsDir = path.join(__dirname, "..", "dist", "renderer", "assets");
  const cssFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "renderer build must emit css assets");
  const css = cssFiles
    .map((file) => fs.readFileSync(path.join(assetsDir, file), "utf8"))
    .join("\n");
  assert.ok(/--ui-canvas:\s*#f8f7f5/.test(css), "warm canvas token must survive CSS parsing");
  assert.ok(/--ui-navigation:\s*#edeae5/.test(css), "sidebar tier token must survive CSS parsing");
  assert.ok(/--ui-primary:\s*#5e6ad2/.test(css), "lavender accent token must survive CSS parsing");
  assert.ok(/--owb-duration-fast:\s*(120ms|\.12s)/.test(css), "motion three-tier tokens must survive CSS parsing");
});
