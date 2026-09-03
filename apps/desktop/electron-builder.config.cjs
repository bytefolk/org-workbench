const path = require("path");
const { RUNTIME_FILE_SETS } = require("./packaging/runtime-layout.cjs");

module.exports = {
  appId: "org.fullstack-ai-infra.org-workbench",
  productName: "Org Workbench",
  directories: {
    output: "release",
  },
  asar: false,
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
    target: [{ target: "dir", arch: ["x64"] }],
    signAndEditExecutable: Boolean(process.env.WINDOWS_SIGNING_ENABLED),
    sign: process.env.WINDOWS_SIGNING_SCRIPT
      ? path.resolve(process.env.WINDOWS_SIGNING_SCRIPT)
      : undefined,
    publisherName: process.env.WINDOWS_SIGNING_ENABLED
      ? process.env.WINDOWS_PUBLISHER_NAME
      : undefined,
  },
};
