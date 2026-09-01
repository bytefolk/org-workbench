import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../../apps/desktop/electron-builder.config.cjs");
const {
  APP_BUNDLE_REQUIRED_ENTRIES,
  APP_RESOURCES_REQUIRED_ENTRIES,
  RUNTIME_FILE_SETS,
} = require("../../apps/desktop/packaging/runtime-layout.cjs");

test("unsigned macOS builder config is arm64 dir-only and cannot sign or publish", () => {
  assert.equal(config.appId, "org.fullstack-ai-infra.org-workbench");
  assert.equal(config.productName, "Org Workbench");
  assert.equal(config.asar, false);
  assert.equal(config.electronDist, "node_modules/electron/dist");
  assert.equal(config.npmRebuild, false);
  assert.deepEqual(config.extraMetadata, { main: "apps/desktop/src/main.js" });
  assert.equal(config.mac.identity, null);
  assert.deepEqual(config.mac.target, [{ target: "dir", arch: ["arm64"] }]);
  assert.deepEqual(config.files, RUNTIME_FILE_SETS);
  assert.equal("publish" in config, false);
});

test("package script installs the exact locked Electron distribution before builder", () => {
  const rootPackage = require("../../package.json");
  const desktopPackage = require("../../apps/desktop/package.json");
  assert.equal(desktopPackage.devDependencies.electron, "43.4.1");
  assert.equal(
    rootPackage.scripts["prepare:electron:macos"],
    "node node_modules/electron/install.js",
  );
  assert.match(
    rootPackage.scripts["package:macos:unsigned"],
    /npm run prepare:electron:macos .* electron-builder/,
  );
  assert.equal(config.electronDist, "node_modules/electron/dist");
});

test("runtime manifest enumerates every entry consumed by packaged main and preload", () => {
  const resources = new Set(APP_RESOURCES_REQUIRED_ENTRIES);
  for (const entry of [
    "package.json",
    "LICENSE",
    "apps/desktop/package.json",
    "apps/desktop/src/main.js",
    "apps/desktop/src/preload.js",
    "apps/desktop/src/control-plane-launch.cjs",
    "apps/desktop/src/macos-login-path.cjs",
    "apps/desktop/src/packaged-smoke.cjs",
    "apps/desktop/dist/renderer/index.html",
    "apps/server/dist/src/index.js",
    "apps/server/bin/qoder-engine.mjs",
    "apps/server/src/qoder-binary.js",
    "apps/server/package.json",
    "node_modules/@org-workbench/shared/package.json",
    "node_modules/@org-workbench/shared/dist/index.js",
    "node_modules/@org-workbench/shared/position-id.cjs",
    "node_modules/@org-workbench/shared/pending-approval.cjs",
    "examples/oss-maintainer/workspace.json",
  ]) {
    assert.equal(resources.has(entry), true, `missing packaged runtime entry: ${entry}`);
  }
  assert.deepEqual(APP_BUNDLE_REQUIRED_ENTRIES, [
    "Contents/Info.plist",
    "Contents/MacOS/Org Workbench",
  ]);
});

test("file sets are narrow and never sweep source-tree node_modules or credentials", () => {
  const rootFileSet = RUNTIME_FILE_SETS.find((entry) => entry.from === ".");
  assert.deepEqual(rootFileSet, {
    from: ".",
    to: ".",
    filter: ["package.json", "LICENSE"],
  });
  assert.equal(
    RUNTIME_FILE_SETS.some((entry) => entry.from.includes("node_modules")),
    false,
  );
  assert.equal(
    RUNTIME_FILE_SETS.some((entry) => JSON.stringify(entry).includes(".env")),
    false,
  );
  const serverFileSet = RUNTIME_FILE_SETS.find((entry) => entry.from === "apps/server");
  assert.deepEqual(serverFileSet, {
    from: "apps/server",
    to: "apps/server",
    filter: ["package.json", "dist/src/**/*", "bin/**/*", "src/qoder-binary.js"],
  });
  assert.equal(
    serverFileSet.filter.some((entry) => entry.includes("dist/test")),
    false,
  );
});
