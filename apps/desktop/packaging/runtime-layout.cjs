const RUNTIME_FILE_SETS = [
  { from: ".", to: ".", filter: ["package.json", "LICENSE"] },
  {
    from: "apps/desktop",
    to: "apps/desktop",
    filter: ["package.json", "src/**/*", "dist/renderer/**/*"],
  },
  {
    from: "apps/server",
    to: "apps/server",
    filter: ["package.json", "dist/src/**/*", "bin/**/*", "src/qoder-binary.js"],
  },
  {
    from: "packages/shared",
    to: "node_modules/@org-workbench/shared",
    filter: ["package.json", "dist/**/*", "position-id.cjs", "pending-approval.cjs"],
  },
  {
    from: "examples/oss-maintainer",
    to: "examples/oss-maintainer",
    filter: ["**/*", "!.digital-employee{,/**/*}"],
  },
];

const APP_BUNDLE_REQUIRED_ENTRIES = [
  "Contents/Info.plist",
  "Contents/MacOS/Org Workbench",
];

const APP_RESOURCES_REQUIRED_ENTRIES = [
  "package.json",
  "LICENSE",
  "apps/desktop/package.json",
  "apps/desktop/src/main.js",
  "apps/desktop/src/preload.js",
  "apps/desktop/src/approval-ipc.cjs",
  "apps/desktop/src/assets-ipc.cjs",
  "apps/desktop/src/control-plane-launch.cjs",
  "apps/desktop/src/docs-ipc.cjs",
  "apps/desktop/src/group-ipc.cjs",
  "apps/desktop/src/hire-ipc.cjs",
  "apps/desktop/src/macos-login-path.cjs",
  "apps/desktop/src/packaged-smoke.cjs",
  "apps/desktop/src/org-ipc.cjs",
  "apps/desktop/src/runtime-paths.cjs",
  "apps/desktop/src/session-ipc.cjs",
  "apps/desktop/src/turn-ipc.cjs",
  "apps/desktop/src/window-ipc.cjs",
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
];

module.exports = {
  APP_BUNDLE_REQUIRED_ENTRIES,
  APP_RESOURCES_REQUIRED_ENTRIES,
  RUNTIME_FILE_SETS,
};
