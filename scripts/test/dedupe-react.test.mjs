// #49 regression: scripts/dedupe-react.mjs must locate the real
// design-system checkout even when it runs from a git worktree copy
// (ancestor-sibling probe + package identity check), must stay a no-op
// when no such checkout exists, and must not regress the classic
// sibling layout from the main clone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dedupe-react.mjs");

function writePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "18.3.1", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), "module.exports = {};");
}

function writeDesignSystem(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@fullstack-ai-infra/ui", version: "0.0.0" }));
  writePackage(join(dir, "node_modules", "react"), "react");
  writePackage(join(dir, "node_modules", "react-dom"), "react-dom");
}

function writeWorkspace(dir) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(scriptPath, join(dir, "scripts", "dedupe-react.mjs"));
  writePackage(join(dir, "node_modules", "react"), "react");
  writePackage(join(dir, "node_modules", "react-dom"), "react-dom");
}

function runScript(workspace) {
  return spawnSync(process.execPath, [join(workspace, "scripts", "dedupe-react.mjs")], { encoding: "utf8" });
}

function assertConverged(designSystem, workspace, names) {
  for (const name of names) {
    const link = join(designSystem, "node_modules", name);
    assert.ok(lstatSync(link).isSymbolicLink(), `${name} should be a symlink`);
    assert.equal(realpathSync(link), realpathSync(join(workspace, "node_modules", name)));
  }
}

test("worktree copy finds design-system via ancestor sibling and rewrites links", (t) => {
  const root = mkdtempSync(join(tmpdir(), "owb-dedupe-worktree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const designSystem = join(root, "design-system");
  const workspace = join(root, "org-workbench", ".worktrees", "issue-x");
  writeDesignSystem(designSystem);
  writeWorkspace(workspace);

  const first = runScript(workspace);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /design-system[/\\]node_modules[/\\]react -> /);
  assert.match(first.stdout, /react resolves from .* to the workspace copy/);
  assertConverged(designSystem, workspace, ["react", "react-dom"]);

  const second = runScript(workspace);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, / -> /, "idempotent rerun must not rewrite");
  assertConverged(designSystem, workspace, ["react", "react-dom"]);
});

test("classic sibling layout from the main clone still works", (t) => {
  const root = mkdtempSync(join(tmpdir(), "owb-dedupe-sibling-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const designSystem = join(root, "design-system");
  const workspace = join(root, "org-workbench");
  writeDesignSystem(designSystem);
  writeWorkspace(workspace);

  const result = runScript(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /react resolves from .* to the workspace copy/);
  assertConverged(designSystem, workspace, ["react", "react-dom"]);
});

test("dangling link in design-system gets rewritten instead of crashing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "owb-dedupe-dangling-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const designSystem = join(root, "design-system");
  const workspace = join(root, "org-workbench", ".worktrees", "issue-y");
  writeDesignSystem(designSystem);
  writeWorkspace(workspace);
  rmSync(join(designSystem, "node_modules", "react"), { recursive: true, force: true });
  symlinkSync(join(root, "nowhere", "react"), join(designSystem, "node_modules", "react"));

  const result = runScript(workspace);
  assert.equal(result.status, 0, result.stderr);
  assertConverged(designSystem, workspace, ["react"]);
});

test("no design-system under any ancestor is an explicit no-op", (t) => {
  const root = mkdtempSync(join(tmpdir(), "owb-dedupe-absent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "lonely", "org-workbench");
  writeWorkspace(workspace);

  const result = runScript(workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no design-system checkout found/);
  assert.doesNotMatch(result.stdout, / -> /);
});
