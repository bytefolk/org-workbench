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
    // Per-user install. A machine-wide install needs elevation, and an unsigned
    // installer asking for elevation is exactly the prompt SmartScreen already
    // makes worse. Per-user keeps the unsigned lane testable without UAC.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
};
