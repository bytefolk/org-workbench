import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CLEAN_RELATIVE_PATHS = Object.freeze([
  "release/staging",
  "apps/desktop/dist/renderer",
  "apps/server/dist",
  "apps/server/tsconfig.tsbuildinfo",
  "packages/shared/dist",
  "packages/shared/tsconfig.tsbuildinfo",
]);

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function inside(root, candidate) {
  const relation = path.relative(root, candidate);
  return relation.length === 0 || (
    relation !== ".." &&
    !relation.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relation)
  );
}

export function assertSafeCleanTarget(root, relative) {
  const resolvedRoot = path.resolve(root);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("refusing to clean through a linked or non-directory project root");
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  if (!samePath(realRoot, resolvedRoot)) {
    throw new Error("refusing to clean through a non-canonical project root");
  }
  const candidate = path.resolve(realRoot, relative);
  const relation = path.relative(realRoot, candidate);
  if (!inside(realRoot, candidate) || relation.length === 0) {
    throw new Error(`refusing to clean path outside project root: ${relative}`);
  }

  let current = realRoot;
  for (const segment of relation.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing to clean through a symbolic link or junction: ${current}`);
    }
    const realCurrent = fs.realpathSync(current);
    if (!inside(realRoot, realCurrent)) {
      throw new Error(`refusing to clean through a path outside project root: ${current}`);
    }
  }

  const currentRootStat = fs.lstatSync(resolvedRoot);
  if (
    currentRootStat.isSymbolicLink() ||
    !currentRootStat.isDirectory() ||
    !sameFileIdentity(rootStat, currentRootStat) ||
    !samePath(fs.realpathSync(resolvedRoot), realRoot)
  ) {
    throw new Error("project root identity changed during package cleanup validation");
  }
  return candidate;
}

export function cleanPackageOutput(root = projectRoot) {
  for (const relative of CLEAN_RELATIVE_PATHS) {
    const target = assertSafeCleanTarget(root, relative);
    // Revalidate immediately before the destructive operation. Node does not
    // expose rm-at, so every existing ancestor must remain canonical twice.
    if (!samePath(target, assertSafeCleanTarget(root, relative))) {
      throw new Error(`package cleanup target changed during validation: ${relative}`);
    }
    fs.rmSync(target, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cleanPackageOutput();
}
