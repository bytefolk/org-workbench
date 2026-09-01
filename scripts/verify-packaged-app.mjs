import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  APP_BUNDLE_REQUIRED_ENTRIES,
  APP_RESOURCES_REQUIRED_ENTRIES,
  WIN_APP_REQUIRED_ENTRIES,
} = require("../apps/desktop/packaging/runtime-layout.cjs");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function regularFile(target) {
  const stat = fs.lstatSync(target);
  assert.equal(stat.isSymbolicLink(), false, `packaged runtime entry must not be a symlink: ${target}`);
  assert.equal(stat.isFile(), true, `packaged runtime entry must be a regular file: ${target}`);
}

function walkFiles(root, filter = () => true) {
  const files = [];
  const visit = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix.length > 0 ? path.join(prefix, entry.name) : entry.name;
      if (relative === ".digital-employee" || relative.startsWith(`.digital-employee${path.sep}`)) continue;
      const absolute = path.join(dir, entry.name);
      // Windows electron-builder can materialize NTFS junctions inside the
      // packaged tree; those show up as symbolic links to lstat. Everywhere
      // we control the layout the packaged runtime must remain a plain file
      // tree, so we still reject links.
      assert.equal(entry.isSymbolicLink(), false, `runtime tree must not contain symlinks: ${absolute}`);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile() && filter(relative)) files.push(relative.split(path.sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

function assertMirroredTree(source, packaged, filter) {
  assert.deepEqual(
    walkFiles(packaged),
    walkFiles(source, filter),
    `packaged runtime tree differs from source build: ${source}`,
  );
}

function plistValue(plist, key) {
  return execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist], {
    encoding: "utf8",
  }).trim();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyResourcesTree(resources) {
  for (const relative of APP_RESOURCES_REQUIRED_ENTRIES) regularFile(path.join(resources, relative));

  assertMirroredTree(
    path.join(projectRoot, "apps", "desktop", "src"),
    path.join(resources, "apps", "desktop", "src"),
  );
  assertMirroredTree(
    path.join(projectRoot, "apps", "desktop", "dist", "renderer"),
    path.join(resources, "apps", "desktop", "dist", "renderer"),
  );
  assertMirroredTree(
    path.join(projectRoot, "apps", "server", "dist", "src"),
    path.join(resources, "apps", "server", "dist", "src"),
  );
  assert.equal(
    fs.existsSync(path.join(resources, "apps", "server", "dist", "test")),
    false,
    "packaged runtime must not contain server tests",
  );
  assertMirroredTree(
    path.join(projectRoot, "apps", "server", "bin"),
    path.join(resources, "apps", "server", "bin"),
  );
  assert.equal(
    sha256(path.join(resources, "apps", "server", "src", "qoder-binary.js")),
    sha256(path.join(projectRoot, "apps", "server", "src", "qoder-binary.js")),
    "packaged qoder binary resolver must exactly match its source runtime file",
  );
  assertMirroredTree(
    path.join(projectRoot, "packages", "shared"),
    path.join(resources, "node_modules", "@org-workbench", "shared"),
    (relative) => relative === "package.json" || relative === "position-id.cjs" ||
      relative === "pending-approval.cjs" || relative.startsWith("dist/"),
  );
  assertMirroredTree(
    path.join(projectRoot, "examples", "oss-maintainer"),
    path.join(resources, "examples", "oss-maintainer"),
  );

  const packagedMetadata = JSON.parse(fs.readFileSync(path.join(resources, "package.json"), "utf8"));
  assert.equal(packagedMetadata.main, "apps/desktop/src/main.js");
  assert.equal(packagedMetadata.name, "org-workbench");
  assert.equal(packagedMetadata.version, "0.0.0");
}

function verifyMacApp(candidate) {
  const appPath = path.resolve(
    candidate ?? path.join(projectRoot, "release", "mac-arm64", "Org Workbench.app"),
  );
  assert.equal(path.basename(appPath), "Org Workbench.app");
  for (const relative of APP_BUNDLE_REQUIRED_ENTRIES) regularFile(path.join(appPath, relative));

  const resources = path.join(appPath, "Contents", "Resources", "app");
  verifyResourcesTree(resources);

  const plist = path.join(appPath, "Contents", "Info.plist");
  assert.equal(plistValue(plist, "CFBundleIdentifier"), "org.fullstack-ai-infra.org-workbench");
  assert.equal(plistValue(plist, "CFBundleExecutable"), "Org Workbench");
  const binary = path.join(appPath, "Contents", "MacOS", "Org Workbench");
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", binary], { encoding: "utf8" }).trim();
  assert.equal(architectures, "arm64", `expected arm64-only app, got ${architectures}`);

  const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  assert.notEqual(signature.status, 0, "local candidate must not carry a sealed application signature");
  assert.equal(
    fs.existsSync(path.join(appPath, "Contents", "_CodeSignature", "CodeResources")),
    false,
    "local candidate must not carry a sealed application signature",
  );
  const signatureInspection = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", binary],
    { encoding: "utf8" },
  );
  assert.equal(signatureInspection.status, 0);
  const signatureDetails = `${signatureInspection.stdout ?? ""}${signatureInspection.stderr ?? ""}`;
  assert.match(signatureDetails, /^Signature=adhoc$/m);
  assert.match(signatureDetails, /^TeamIdentifier=not set$/m);
  assert.doesNotMatch(signatureDetails, /^Authority=/m);

  return {
    schemaVersion: "org-workbench-package-manifest.v1",
    ok: true,
    platform: "darwin",
    appPath,
    architectures,
    developerSigned: false,
    linkerAdhocSignature: true,
    requiredEntries: APP_BUNDLE_REQUIRED_ENTRIES.length + APP_RESOURCES_REQUIRED_ENTRIES.length,
    mainSha256: sha256(path.join(resources, "apps", "desktop", "src", "main.js")),
    rendererSha256: sha256(path.join(resources, "apps", "desktop", "dist", "renderer", "index.html")),
    serverSha256: sha256(path.join(resources, "apps", "server", "dist", "src", "index.js")),
    qoderBinarySha256: sha256(path.join(resources, "apps", "server", "src", "qoder-binary.js")),
  };
}

function verifyWinApp(candidate) {
  const appPath = path.resolve(
    candidate ?? path.join(projectRoot, "release", "win-unpacked"),
  );
  assert.equal(path.basename(appPath), "win-unpacked");
  for (const relative of WIN_APP_REQUIRED_ENTRIES) regularFile(path.join(appPath, relative));

  const resources = path.join(appPath, "resources", "app");
  verifyResourcesTree(resources);

  // Windows electron-builder emits the productName as the top-level exe; we
  // treat its presence as the equivalent of the macOS bundle's Info.plist.
  // Signing is a separate story (kept out of the unsigned build); the smoke
  // job proves the app actually launches.
  const exePath = path.join(appPath, "Org Workbench.exe");
  const exeStat = fs.statSync(exePath);
  assert.equal(exeStat.isFile(), true, "packaged Windows entry point must be a regular file");
  assert.ok(exeStat.size > 0, "packaged Windows entry point must not be empty");

  return {
    schemaVersion: "org-workbench-package-manifest.v1",
    ok: true,
    platform: "win32",
    appPath,
    architectures: "x64",
    developerSigned: false,
    linkerAdhocSignature: false,
    requiredEntries: WIN_APP_REQUIRED_ENTRIES.length + APP_RESOURCES_REQUIRED_ENTRIES.length,
    mainSha256: sha256(path.join(resources, "apps", "desktop", "src", "main.js")),
    rendererSha256: sha256(path.join(resources, "apps", "desktop", "dist", "renderer", "index.html")),
    serverSha256: sha256(path.join(resources, "apps", "server", "dist", "src", "index.js")),
    qoderBinarySha256: sha256(path.join(resources, "apps", "server", "src", "qoder-binary.js")),
  };
}

export function verifyPackagedApp(candidate) {
  if (process.platform === "darwin") return verifyMacApp(candidate);
  if (process.platform === "win32") return verifyWinApp(candidate);
  throw new Error(`packaged verification is only supported on macOS and Windows, not ${process.platform}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = verifyPackagedApp(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
