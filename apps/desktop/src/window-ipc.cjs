// Window-control IPC trust boundary (#77 review item 2).
//
// ipcMain.handle() is not scoped to any particular window: any renderer
// frame that can reach the preload's exposed method could otherwise
// minimize/maximize/close a window it does not own. This app only ever
// creates one BrowserWindow, so the check is: the invoking frame must be
// that window's own top-level main frame, currently showing exactly the
// packaged renderer file — never a subframe/webview, a stale reference from
// a closed window, or a frame that navigated away from the packaged app.
//
// Kept electron-free and pure so it is unit-testable without a real
// BrowserWindow (mirrors org-ipc.cjs / hire-ipc.cjs etc.).

/**
 * @param {{ senderFrame?: { url?: unknown } | null } | null | undefined} event
 * @param {{ webContents?: { mainFrame?: unknown } } | null | undefined} expectedWindow
 * @param {string} allowedUrl - exact file:// URL of the packaged renderer entry
 */
function isTrustedWindowSender(event, expectedWindow, allowedUrl) {
  const frame = event && event.senderFrame;
  if (!frame) return false;
  if (!expectedWindow || !expectedWindow.webContents) return false;
  // Identity check: must be the exact main-frame object of the one window
  // this shell owns. An attacker cannot forge this reference.
  if (frame !== expectedWindow.webContents.mainFrame) return false;
  // Defense in depth: even the legitimate main frame must still be showing
  // the packaged app, not something will-navigate failed to block.
  return frame.url === allowedUrl;
}

/**
 * `webContents.on("will-navigate")` guard: only the already-loaded packaged
 * file may be the target (e.g. a reload); any other URL — remote http(s),
 * a different local file — must be blocked.
 */
function isAllowedNavigationTarget(targetUrl, allowedUrl) {
  return typeof targetUrl === "string" && typeof allowedUrl === "string" && targetUrl === allowedUrl;
}

module.exports = { isTrustedWindowSender, isAllowedNavigationTarget };
