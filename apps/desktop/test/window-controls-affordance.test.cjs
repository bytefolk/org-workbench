// #94 regression: the three real window-control buttons (`.owb-wctl`, added in
// #73 for the frameless custom title bar) rendered their close/minimize/maximize
// glyphs at `opacity: 0` by default, only reaching `opacity: 1` on hover/focus of
// the *entire* title bar. Unlike a decorative macOS traffic light, these are the
// only way to close/minimize/maximize the window, so shipping zero default
// affordance was a discoverability defect, not a stylistic choice (reported
// directly while reviewing this PR).
//
// This is a CSS-only guard, following contrast.test.cjs / agent-host-width's
// lead: jsdom does not apply a real stylesheet cascade, so the invariant is
// checked against the built bundle rather than rendered and screenshotted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function builtCss() {
  const assetsDir = path.join(__dirname, "..", "dist", "renderer", "assets");
  const cssFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "renderer build must emit css assets");
  return cssFiles.map((file) => fs.readFileSync(path.join(assetsDir, file), "utf8")).join("\n");
}

test("window-control glyphs are visible without hovering the title bar (#94)", () => {
  const css = builtCss();

  const baseRule = /\.owb-wctl>svg\{([^}]*)\}/.exec(css);
  assert.ok(baseRule !== null, ".owb-wctl>svg base rule must exist");
  assert.ok(
    !/opacity\s*:\s*0\b/.test(baseRule[1]),
    `.owb-wctl>svg must not default to opacity:0 (hides a real, non-decorative control until a broad title-bar hover); got "${baseRule[1]}"`,
  );

  // The hover/focus rule still exists — it upgrades the stroke to a dark tone
  // for contrast against the semantic danger/warning/success hover background,
  // it just no longer does the *only* rendering of the glyph.
  assert.ok(
    /\.owb-wintitle:hover \.owb-wctl>svg,\.owb-wctl:focus-visible>svg,\.owb-wintitle:hover \.owb-wctl>svg rect,\.owb-wctl:focus-visible>svg rect\{stroke:[^}]+\}/.test(
      css,
    ),
    "hover/focus must still swap the glyph stroke for contrast against the semantic background",
  );
});
