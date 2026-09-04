// #77 review item 2: window-control IPC trust boundary. ipcMain.handle() is
// not scoped to a window on its own — these tests exercise the pure
// predicate main.js gates every owb:window:* handler on, with fake
// event/window shapes (no real Electron BrowserWindow needed).
const assert = require("node:assert/strict");
const test = require("node:test");
const { isAllowedNavigationTarget, isTrustedWindowSender } = require("../src/window-ipc.cjs");

const ALLOWED_URL = "file:///app/apps/desktop/dist/renderer/index.html";
const TRUSTED_FRAME = { url: ALLOWED_URL };
const TRUSTED_WINDOW = { webContents: { mainFrame: TRUSTED_FRAME } };

test("isTrustedWindowSender: accepts the window's own main frame showing the packaged file", () => {
  const event = { senderFrame: TRUSTED_FRAME };
  assert.equal(isTrustedWindowSender(event, TRUSTED_WINDOW, ALLOWED_URL), true);
});

test("isTrustedWindowSender: rejects a different frame object (subframe/webview/second window)", () => {
  const foreignFrame = { url: ALLOWED_URL }; // same URL, but not the === mainFrame reference
  const event = { senderFrame: foreignFrame };
  assert.equal(isTrustedWindowSender(event, TRUSTED_WINDOW, ALLOWED_URL), false);
});

test("isTrustedWindowSender: rejects the real main frame if it navigated away from the packaged file", () => {
  const navigatedFrame = { url: "https://attacker.example/phish.html" };
  const window = { webContents: { mainFrame: navigatedFrame } };
  const event = { senderFrame: navigatedFrame };
  assert.equal(isTrustedWindowSender(event, window, ALLOWED_URL), false);
});

test("isTrustedWindowSender: rejects a missing senderFrame (destroyed/cross-origin edge case)", () => {
  assert.equal(isTrustedWindowSender({ senderFrame: null }, TRUSTED_WINDOW, ALLOWED_URL), false);
  assert.equal(isTrustedWindowSender({}, TRUSTED_WINDOW, ALLOWED_URL), false);
});

test("isTrustedWindowSender: rejects when there is no live target window (already closed)", () => {
  const event = { senderFrame: TRUSTED_FRAME };
  assert.equal(isTrustedWindowSender(event, null, ALLOWED_URL), false);
  assert.equal(isTrustedWindowSender(event, {}, ALLOWED_URL), false);
});

test("isAllowedNavigationTarget: only the exact already-loaded packaged file passes", () => {
  assert.equal(isAllowedNavigationTarget(ALLOWED_URL, ALLOWED_URL), true);
  assert.equal(isAllowedNavigationTarget("https://attacker.example/", ALLOWED_URL), false);
  assert.equal(isAllowedNavigationTarget("file:///app/other/index.html", ALLOWED_URL), false);
  assert.equal(isAllowedNavigationTarget(undefined, ALLOWED_URL), false);
});
