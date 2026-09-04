const path = require("node:path");

/**
 * Resolve the renderer produced by apps/desktop/vite.config.ts.
 *
 * Keep this in a dependency-free module so the clean-build contract can be
 * verified without booting Electron.
 */
function rendererEntryPath(desktopSourceDir) {
  return path.join(desktopSourceDir, "..", "dist", "renderer", "index.html");
}

module.exports = { rendererEntryPath };
