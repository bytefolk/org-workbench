// #94 defect 2 regression: both Agent Host columns were sized for roughly half
// of their own longest option (`minmax(150px, 0.45fr)` in the turn panel, a
// *fixed* 150px track in the group panel), so the selected host was ellipsised
// mid-CJK and — because the popup inherits the trigger width unless told
// otherwise — the dropdown was unreadable too.
//
// The behavioural half (compact trigger label, full text in the popup, popup no
// longer width-bound) is covered by renderer/test/agent-host-select.test.tsx.
// This asserts the CSS half, which jsdom cannot measure. It is a floor, not a
// pixel pin: the compact trigger label `✳ Claude Code · 本地登录` needs ~208px at
// Inter 14px including antd's selector padding and arrow inset, so anything
// below 200px is the old bug returning.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIN_TRIGGER_PX = 200;

function builtCss() {
  const assetsDir = path.join(__dirname, "..", "dist", "renderer", "assets");
  const cssFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "renderer build must emit css assets");
  return cssFiles.map((file) => fs.readFileSync(path.join(assetsDir, file), "utf8")).join("\n");
}

/** The declared floor of a grid track: a bare `220px` or the first argument of
 * `minmax(220px, …)`. Returns null when the track has no px floor at all. */
function trackFloorPx(track) {
  const minmax = /^minmax\(\s*(\d+(?:\.\d+)?)px\s*,/.exec(track);
  if (minmax !== null) return Number(minmax[1]);
  const bare = /^(\d+(?:\.\d+)?)px$/.exec(track);
  return bare === null ? null : Number(bare[1]);
}

/** Second track of the first `grid-template-columns` under `selector`. Both
 * layouts are `<content column> <Agent Host column>`; the restacked
 * single-column variants under the narrow-window media queries are skipped by
 * taking only two-track declarations. */
function agentHostTrack(css, selector) {
  const pattern = new RegExp(
    `${selector}\\{[^}]*grid-template-columns:\\s*(minmax\\([^)]*\\)|[^;}]+?)\\s+(minmax\\([^)]*\\)|[\\d.]+px|[^;}]+?)\\s*[;}]`,
  );
  const match = pattern.exec(css);
  assert.ok(match !== null, `${selector} must declare a two-track grid-template-columns`);
  return match[2].trim();
}

test("Agent Host columns stay wide enough for the compact trigger label (#94)", () => {
  const css = builtCss();

  for (const selector of ["\\.owb-turn-panel__controls", "\\.owb-groups__panel-sub"]) {
    const track = agentHostTrack(css, selector);
    const floor = trackFloorPx(track);
    assert.ok(
      floor !== null,
      `${selector} Agent Host track "${track}" must declare a px floor, otherwise the trigger can collapse below its label`,
    );
    assert.ok(
      floor >= MIN_TRIGGER_PX,
      `${selector} Agent Host track floor is ${floor}px, below the ${MIN_TRIGGER_PX}px the compact label needs (#94)`,
    );
  }
});
