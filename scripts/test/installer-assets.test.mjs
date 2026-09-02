import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyEntries,
  expectedArtifacts,
  isPermittedCompanion,
} from "../verify-installer-assets.mjs";

const META = { name: "org-workbench", version: "0.0.0" };

function fixture(t, entries) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owb-installer-assets-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  for (const entry of entries) fs.writeFileSync(path.join(root, entry), "x");
  return root;
}

test("the expected set names the architecture, so a wrong-arch build cannot pass", () => {
  assert.deepEqual(expectedArtifacts("macos", META), [
    "org-workbench-0.0.0-arm64.dmg",
    "org-workbench-0.0.0-arm64.zip",
  ]);
  assert.deepEqual(expectedArtifacts("windows", META), ["org-workbench-0.0.0-x64.exe"]);
  assert.throws(() => expectedArtifacts("linux", META), /unsupported installer platform/);
});

test("a complete output classifies clean", () => {
  const required = expectedArtifacts("macos", META);
  const { missing, unexpected } = classifyEntries([...required], required);
  assert.deepEqual(missing, []);
  assert.deepEqual(unexpected, []);
});

test("a missing artifact is reported by name", () => {
  const required = expectedArtifacts("macos", META);
  const { missing } = classifyEntries(["org-workbench-0.0.0-arm64.dmg"], required);
  assert.deepEqual(missing, ["org-workbench-0.0.0-arm64.zip"]);
});

test("an artifact this lane does not claim is reported", () => {
  const required = expectedArtifacts("windows", META);
  // An MSI would mean the build produced a target nobody asked for.
  const { unexpected } = classifyEntries(
    ["org-workbench-0.0.0-x64.exe", "org-workbench-0.0.0-x64.msi"],
    required,
  );
  assert.deepEqual(unexpected, ["org-workbench-0.0.0-x64.msi"]);
});

test("blockmaps and update metadata are permitted companions, nothing else is", () => {
  const required = expectedArtifacts("windows", META);
  assert.equal(isPermittedCompanion("org-workbench-0.0.0-x64.exe.blockmap", required), true);
  assert.equal(isPermittedCompanion("latest.yml", required), true);
  assert.equal(isPermittedCompanion("latest-mac.yml", required), true);
  // A blockmap for something that is not a required artifact is not a companion.
  assert.equal(isPermittedCompanion("something-else.exe.blockmap", required), false);
  assert.equal(isPermittedCompanion("builder-debug.yml", required), false);
});

test("a wrong-architecture build fails rather than passing on a glob", () => {
  const required = expectedArtifacts("windows", META);
  const { missing, unexpected } = classifyEntries(["org-workbench-0.0.0-ia32.exe"], required);
  assert.deepEqual(missing, ["org-workbench-0.0.0-x64.exe"]);
  assert.deepEqual(unexpected, ["org-workbench-0.0.0-ia32.exe"]);
});

test("the fixture helper keeps these cases honest about real directory reads", (t) => {
  const required = expectedArtifacts("macos", META);
  const root = fixture(t, [...required, "org-workbench-0.0.0-arm64.dmg.blockmap"]);
  const entries = fs.readdirSync(root).sort();
  const { missing, unexpected } = classifyEntries(entries, required);
  assert.deepEqual(missing, []);
  assert.deepEqual(unexpected, []);
});
