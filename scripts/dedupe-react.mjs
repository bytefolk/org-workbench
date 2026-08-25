#!/usr/bin/env node
// The design-system repo is consumed via file: and carries its own
// node_modules (devDeps include react/react-dom). A second React copy
// breaks hooks at runtime/test time, so repoint design-system's react
// and react-dom at this workspace's copies. Idempotent; no-ops when
// either tree is missing.
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceCopy = (name) => join(root, "node_modules", name);
const siblingCopy = (name) => resolve(root, "..", "design-system", "node_modules", name);

for (const name of ["react", "react-dom"]) {
  const canonical = workspaceCopy(name);
  const sibling = siblingCopy(name);
  if (!existsSync(canonical) || !existsSync(sibling)) continue;
  if (realpathSync(sibling) === realpathSync(canonical)) continue;
  if (lstatSync(sibling).isSymbolicLink()) {
    unlinkSync(sibling);
  } else {
    rmSync(sibling, { recursive: true, force: true });
  }
  mkdirSync(dirname(sibling), { recursive: true });
  symlinkSync(relative(dirname(sibling), canonical), sibling);
  console.log(`dedupe-react: ${sibling} -> ${canonical}`);
}
