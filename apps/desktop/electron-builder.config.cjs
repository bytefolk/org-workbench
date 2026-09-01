const { RUNTIME_FILE_SETS } = require("./packaging/runtime-layout.cjs");

module.exports = {
  appId: "org.fullstack-ai-infra.org-workbench",
  productName: "Org Workbench",
  directories: {
    output: "release",
  },
  asar: false,
  // The package script materializes the exact locked Electron distribution
  // through Electron's checksum-verifying installer. Reuse that directory so
  // electron-builder never performs a separate, implicit download.
  electronDist: "node_modules/electron/dist",
  npmRebuild: false,
  extraMetadata: {
    main: "apps/desktop/src/main.js",
  },
  files: RUNTIME_FILE_SETS,
  mac: {
    category: "public.app-category.developer-tools",
    identity: null,
    target: [{ target: "dir", arch: ["arm64"] }],
  },
  win: {
    // Unsigned dir output; matches the macOS strategy of proving the packaged
    // tree first, before any code-signing story is layered on. Explicit x64
    // avoids electron-builder cross-compiling to ia32 by default.
    target: [{ target: "dir", arch: ["x64"] }],
    signAndEditExecutable: false,
  },
};
