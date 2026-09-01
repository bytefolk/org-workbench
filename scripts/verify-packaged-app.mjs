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

export function verifyPackagedApp(candidate = path.join(projectRoot, "release", "mac-arm64", "Org Workbench.app")) {
  const appPath = path.resolve(candidate);
  assert.equal(process.platform, "darwin", "macOS package verification must run on macOS");
  assert.equal(path.basename(appPath), "Org Workbench.app");
  for (const relative of APP_BUNDLE_REQUIRED_ENTRIES) regularFile(path.join(appPath, relative));

  const resources = path.join(appPath, "Contents", "Resources", "app");
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = verifyPackagedApp(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
