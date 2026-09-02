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
  // #248: the glyph is dark by default so it reads on the always-on colored disc.
  // (cssnano may emit the dark stroke as 8-digit hex #000000xx instead of rgba().)
  assert.ok(
    /stroke:(?:rgba\(0,0,0,|#000000)/.test(baseRule[1]),
    `.owb-wctl>svg must default to a dark visible stroke; got "${baseRule[1]}"`,
  );
});

// #248 小 UI 单：三钮常显彩色圆底（close 红 / min 琥珀 / max 绿），语义色随主题
// 经 var 切换；不再是灰点 hover 才显形。
test("window controls are always-on colored discs (#248)", () => {
  const css = builtCss();
  assert.ok(
    /\.owb-wctl--close\{[^}]*background:var\(--ui-danger\)/.test(css),
    "close button must default to the danger fill",
  );
  assert.ok(
    /\.owb-wctl--min\{[^}]*background:var\(--ui-warning\)/.test(css),
    "minimize button must default to the warning fill",
  );
  assert.ok(
    /\.owb-wctl--max\{[^}]*background:var\(--ui-success\)/.test(css),
    "fullscreen button must default to the success fill",
  );
});
