#!/usr/bin/env node
/** #127 AC-004: cross-platform layout parity for the two-column org workspace.
 * Compares the `layout` measurements embedded in the packaged static smoke
 * reports produced on macOS arm64 and Windows x64 (both launch the same
 * 1240x800 window against the same bundled fixture workspace).
 *
 * Thresholds (declared, reviewable here):
 *  - per-platform bottomDelta (left column bottom vs turn panel bottom) <= 2px;
 *  - cross-platform column width delta  <= 4px (fr tracks, same window width);
 *  - cross-platform column height delta <= 8px (chrome metrics may differ slightly).
 * A missing `layout` on either side fails loudly: the module must render on
 * both platforms for the parity claim to mean anything. */
import fs from "node:fs";

const BOTTOM_DELTA_MAX = 2;
const CROSS_WIDTH_DELTA_MAX = 4;
const CROSS_HEIGHT_DELTA_MAX = 8;

const [macPath, winPath] = process.argv.slice(2);
if (!macPath || !winPath) {
  console.error("usage: node scripts/check-layout-parity.mjs <mac-report.json> <win-report.json>");
  process.exit(2);
}

function readLayout(file) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!report || typeof report !== "object" || report.layout === undefined) {
    throw new Error(`${file}: smoke report has no layout measurement`);
  }
  if (report.layout === null) {
    throw new Error(`${file}: layout is null — the two-column org module did not render`);
  }
  return report.layout;
}

const failures = [];
const mac = readLayout(macPath);
const win = readLayout(winPath);

for (const [name, layout] of [["macos", mac], ["windows", win]]) {
  if (layout.bottomDelta > BOTTOM_DELTA_MAX) {
    failures.push(`${name}: column bottom delta ${layout.bottomDelta}px exceeds ${BOTTOM_DELTA_MAX}px`);
  }
}
if (Math.abs(mac.leftWidth - win.leftWidth) > CROSS_WIDTH_DELTA_MAX) {
  failures.push(`left column width differs: mac ${mac.leftWidth}px vs win ${win.leftWidth}px (max ${CROSS_WIDTH_DELTA_MAX}px)`);
}
if (Math.abs(mac.rightWidth - win.rightWidth) > CROSS_WIDTH_DELTA_MAX) {
  failures.push(`turn panel width differs: mac ${mac.rightWidth}px vs win ${win.rightWidth}px (max ${CROSS_WIDTH_DELTA_MAX}px)`);
}
if (Math.abs(mac.leftHeight - win.leftHeight) > CROSS_HEIGHT_DELTA_MAX) {
  failures.push(`left column height differs: mac ${mac.leftHeight}px vs win ${win.leftHeight}px (max ${CROSS_HEIGHT_DELTA_MAX}px)`);
}
if (Math.abs(mac.rightHeight - win.rightHeight) > CROSS_HEIGHT_DELTA_MAX) {
  failures.push(`turn panel height differs: mac ${mac.rightHeight}px vs win ${win.rightHeight}px (max ${CROSS_HEIGHT_DELTA_MAX}px)`);
}

if (failures.length > 0) {
  console.error("layout parity FAILED:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, mac, win }));
