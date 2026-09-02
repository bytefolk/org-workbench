const { RUNTIME_FILE_SETS } = require("./packaging/runtime-layout.cjs");

module.exports = {
  appId: "org.fullstack-ai-infra.org-workbench",
  productName: "Org Workbench",
  directories: {
    output: "release/staging",
  },
  asar: false,
  // npm ci materializes the checksum-verified, platform-native Electron dist.
  // Native CI jobs reuse it and never ask builder to fetch another Electron.
  electronDist: "node_modules/electron/dist",
  npmRebuild: false,
  extraMetadata: {
    main: "apps/desktop/src/main.js",
  },
  files: RUNTIME_FILE_SETS,
  // Pinned so the asset-set validator can name what it expects rather than
  // pattern-match. `name` rather than `productName`: the product name contains a
  // space, and a space in an artifact filename has already cost this lane one
  // round of Windows shell defects.
  artifactName: "${name}-${version}-${arch}.${ext}",
  mac: {
    category: "public.app-category.developer-tools",
    identity: null,
  },
  // Lane A is deterministic unsigned staging even when an operator shell has
  // CSC_LINK/WIN_CSC_LINK. Keep PE metadata editing, but never enter signing.
  win: {
    signExecutable: false,
  },
  nsis: {
    // Strictly per-user install. Assisted mode exposes an all-users choice and
    // can elevate; one-click mode with perMachine=false keeps this unsigned lane
    // out of that path. Installation-directory choice is intentionally disabled
    // because electron-builder only supports it for assisted installers.
    oneClick: true,
    perMachine: false,
  },
};
