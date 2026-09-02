import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "release", "dist");

/**
 * The installable artifacts each platform must produce, derived from the pinned
 * `artifactName` in the builder config. Named rather than pattern-matched: a
 * glob would pass on a build that silently produced the wrong architecture.
 */
export function expectedArtifacts(platform, { name, version }) {
  if (platform === "macos") {
    return [`${name}-${version}-arm64.dmg`, `${name}-${version}-arm64.zip`];
  }
  if (platform === "windows") {
    return [`${name}-${version}-x64.exe`];
  }
  throw new Error(`unsupported installer platform: ${platform}`);
}

/**
 * Companions electron-builder emits alongside a required artifact. They are
 * permitted but not required: whether a target emits a blockmap depends on the
 * target, and `latest*.yml` appears only once a publish provider is configured,
 * which this lane deliberately does not do.
 */
export function isPermittedCompanion(entry, required) {
  if (/^latest.*\.yml$/.test(entry)) return true;
  return required.some((artifact) => entry === `${artifact}.blockmap`);
}

export function classifyEntries(entries, required) {
  const present = required.filter((artifact) => entries.includes(artifact));
  const missing = required.filter((artifact) => !entries.includes(artifact));
  const unexpected = entries.filter(
    (entry) => !required.includes(entry) && !isPermittedCompanion(entry, required),
  );
  return { present, missing, unexpected };
}

function readOutputEntries(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`installer output contains a link: ${entry.name}`);
    }
    // electron-builder leaves its unpacked staging tree next to the installers.
    // It is an input to the installer, not a release asset, so it is not part of
    // the asset set -- but anything else that is a directory is unexplained.
    if (entry.isDirectory()) {
      if (/-unpacked$/.test(entry.name) || entry.name === "mac-arm64" || entry.name === "mac") continue;
      throw new Error(`installer output contains an unexpected directory: ${entry.name}`);
    }
    if (!entry.isFile()) throw new Error(`installer output contains a special file: ${entry.name}`);
    found.push(entry.name);
  }
  return found.sort();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function verifyInstallerAssets(platform, root = outputRoot) {
  const expectedHost = platform === "macos" ? "darwin" : platform === "windows" ? "win32" : null;
  assert.notEqual(expectedHost, null, `unsupported installer platform: ${platform}`);
  assert.equal(
    process.platform,
    expectedHost,
    `${platform} installer verification must run on its native host`,
  );
  assert.equal(fs.existsSync(root), true, `installer output is missing: ${root}`);

  const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const required = expectedArtifacts(platform, metadata);
  const entries = readOutputEntries(root);
  const { missing, unexpected } = classifyEntries(entries, required);

  assert.deepEqual(
    missing,
    [],
    `installer output is missing required artifacts.\n  expected: ${required.join(", ")}\n  found:    ${entries.join(", ") || "(nothing)"}`,
  );
  assert.deepEqual(
    unexpected,
    [],
    `installer output carries artifacts this lane does not claim.\n  unexpected: ${unexpected.join(", ")}\n  found:      ${entries.join(", ")}`,
  );

  return {
    schemaVersion: "org-workbench-installer-assets.v1",
    ok: true,
    platform,
    version: metadata.version,
    unsigned: true,
    artifacts: required.map((artifact) => {
      const file = path.join(root, artifact);
      return { name: artifact, bytes: fs.statSync(file).size, sha256: sha256(file) };
    }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2];
  try {
    console.log(JSON.stringify(verifyInstallerAssets(platform)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
