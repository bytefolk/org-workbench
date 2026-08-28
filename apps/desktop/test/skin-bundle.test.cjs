// #50 regression: a stray `*/` inside the antd-skin.css header comment closed the
// comment early, and the CSS parser dropped the whole light-theme :root token block
// (caught by CDP computed-value audit, invisible to static checks). Assert the
// skin token values survive parsing in the built renderer bundle.
//
// #73 update: values are now the Control Plane v2 warm-paper set (取代 #31 冻结值).
// This guard fired again during #73 — the header comment mentioned
// `--ui-duration-*/--ui-ease`, whose `*/` re-closed the comment and dropped the
// block a second time. Keep variable names out of prose, or write them without
// the glob.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("renderer bundle keeps the Control Plane v2 skin token block (#50, #73)", () => {
  const assetsDir = path.join(__dirname, "..", "dist", "renderer", "assets");
  const cssFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "renderer build must emit css assets");
  const css = cssFiles
    .map((file) => fs.readFileSync(path.join(assetsDir, file), "utf8"))
    .join("\n");

  // Light theme: warm paper canvas / navigation tier / single lavender accent.
  assert.ok(/--ui-canvas:\s*#f4f1e8/.test(css), "warm paper canvas token must survive CSS parsing");
  assert.ok(/--ui-navigation:\s*#ece8dc/.test(css), "sidebar tier token must survive CSS parsing");
  assert.ok(/--ui-primary:\s*#5e6ad2/.test(css), "lavender accent token must survive CSS parsing");
  // Muted health states (control-plane 设计稿, not the antd bright palette).
  assert.ok(/--ui-success:\s*#3f7d4e/.test(css), "muted success token must survive CSS parsing");
  // Three-tier motion + the display font token added by #73.
  assert.ok(
    /--owb-duration-mid:\s*(160ms|\.16s)/.test(css),
    "motion three-tier tokens must survive CSS parsing",
  );
  assert.ok(/--owb-font-display:\s*["']?Space Grotesk/.test(css), "display font token must survive CSS parsing");

  // Dark theme block must survive the same parsing path.
  assert.ok(/--ui-canvas:\s*#1b1d19/.test(css), "dark canvas token must survive CSS parsing");
  assert.ok(/--ui-primary:\s*#8b93e0/.test(css), "dark lavender accent must survive CSS parsing");
});
