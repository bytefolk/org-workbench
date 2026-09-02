import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VENDOR_RELATIVE = "apps/desktop/src/vendor/electron-updater.cjs";

/**
 * electron-updater is the app's only third-party runtime dependency, and the
 * staging manifest is a per-file allowlist with no third-party node_modules set
 * -- deliberately, because the packaged tree is a boundary. Shipping the package
 * as-is would add 16 packages and 325 files to a tree that asserts 189 files
 * byte-exact.
 *
 * So it is bundled to a single vendored file, which the manifest names as one
 * entry. The reference project takes the same approach for the same reason: it
 * bundles its whole main process and lists only `node-pty` from node_modules,
 * because a native module cannot be bundled. electron-updater is pure JS, so it
 * can be.
 *
 * The main process itself stays as source. Bundling one dependency is a smaller
 * change than changing how the shell ships.
 */
export async function bundleUpdater({ root = projectRoot, write = true } = {}) {
  const outfile = path.join(root, VENDOR_RELATIVE);
  const result = await esbuild.build({
    entryPoints: [path.join(root, "node_modules", "electron-updater", "out", "main.js")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    // Electron 43 ships Node 22. Targeting lower would only cost transpilation
    // this runtime does not need.
    target: "node20",
    // `electron` is provided by the runtime, never bundled.
    external: ["electron"],
    // Keep it legible enough to read a stack trace in a packaged app.
    minify: false,
    sourcemap: false,
    legalComments: "inline",
    logLevel: "silent",
    write,
    ...(write ? {} : { write: false }),
  });
  if (!write) {
    return { bytes: result.outputFiles[0].contents, sha256: null };
  }
  const contents = fs.readFileSync(outfile);
  return {
    outfile,
    relative: VENDOR_RELATIVE,
    bytes: contents.length,
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bundleUpdater()
    .then((report) => console.log(JSON.stringify({ schemaVersion: "org-workbench-vendor-bundle.v1", ...report })))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
