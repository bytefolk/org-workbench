// @ts-check

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a candidate to its executable regular-file target.
 * Mirrors the Qoder resolver: follows symlinks, verifies isFile + X_OK.
 *
 * @param {string} candidate
 * @returns {string | null}
 */
function executableTarget(candidate) {
  try {
    const resolved = fs.realpathSync(candidate);
    if (!fs.statSync(resolved).isFile()) return null;
    fs.accessSync(resolved, fs.constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}

/**
 * @param {string} name
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 * @returns {string | null}
 */
function findOnPath(name, env, platform) {
  const pathValue = env.PATH ?? "";
  if (pathValue.length === 0) return null;
  const extensions = platform === "win32" && path.extname(name).length === 0
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      const found = executableTarget(path.join(directory, `${name}${extension}`));
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Resolve the Claude Code executable without invoking a shell.
 * Resolution order mirrors the Qoder contract:
 *
 * 1. explicit `DIGITAL_EMPLOYEE_CLAUDE_COMMAND` (authoritative; invalid fails closed),
 * 2. `claude` from PATH.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} [platform]
 * @returns {string | null}
 */
export function resolveClaudeExecutable(env, platform = process.platform) {
  const explicit = (env.DIGITAL_EMPLOYEE_CLAUDE_COMMAND ?? "").trim();
  if (explicit.length > 0) {
    if (explicit.includes("\0")) return null;
    const pathLike = path.isAbsolute(explicit) || explicit.includes("/") || explicit.includes("\\");
    return pathLike ? executableTarget(path.resolve(explicit)) : findOnPath(explicit, env, platform);
  }

  return findOnPath("claude", env, platform);
}
