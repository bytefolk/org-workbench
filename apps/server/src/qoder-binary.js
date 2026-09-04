// @ts-check

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a candidate to its executable regular-file target.
 *
 * Symlinked command entries are allowed (the supported qodercli installer uses
 * one), but their final target must be a regular executable file. The resolved
 * absolute path is returned so both health and the turn adapter spawn the same
 * binary without a shell.
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
 * Resolve the Qoder executable without invoking a shell or inspecting account
 * state. Resolution order is deliberately shared by `/health` and
 * `qoder-engine turn run`:
 *
 * 1. explicit `ORG_WORKBENCH_QODER_BIN` (authoritative; invalid fails closed),
 * 2. explicit `DIGITAL_EMPLOYEE_QODER_COMMAND` (authoritative; digital-employee
 *    contract; invalid fails closed),
 * 3. native `qodercli` (International) then `qoderclicn` (China), then the
 *    `qoder` / `qodercn` / `qoder-cn` dispatchers, from PATH,
 * 4. supported per-user macOS install paths for Finder-launched apps
 *    (International under `~/.qoder/`, China under `~/.qoder-cn/`).
 *
 * International names come before their China equivalents so that a host with
 * both editions logged in keeps the existing default. Only exact candidate
 * paths are checked; no home-directory scan is performed.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} [platform]
 * @returns {string | null}
 */
export function resolveQoderExecutable(env, platform = process.platform) {
  const explicitBin = (env.ORG_WORKBENCH_QODER_BIN ?? "").trim();
  if (explicitBin.length > 0) {
    if (explicitBin.includes("\0")) return null;
    const pathLike = path.isAbsolute(explicitBin) || explicitBin.includes("/") || explicitBin.includes("\\");
    return pathLike ? executableTarget(path.resolve(explicitBin)) : findOnPath(explicitBin, env, platform);
  }
  // #200: honor the digital-employee override (TURN_ENGINE_QODER_COMMAND_ENV
  // upstream) symmetrically with DIGITAL_EMPLOYEE_CLAUDE_COMMAND. It names a
  // binary and carries no credential, so it fits the existing allowlist
  // discipline and lets operators point at the CN edition without a PATH shim.
  const explicitCommand = (env.DIGITAL_EMPLOYEE_QODER_COMMAND ?? "").trim();
  if (explicitCommand.length > 0) {
    if (explicitCommand.includes("\0")) return null;
    const pathLike =
      path.isAbsolute(explicitCommand) || explicitCommand.includes("/") || explicitCommand.includes("\\");
    return pathLike ? executableTarget(path.resolve(explicitCommand)) : findOnPath(explicitCommand, env, platform);
  }

  for (const name of ["qodercli", "qoderclicn", "qoder", "qodercn", "qoder-cn"]) {
    const found = findOnPath(name, env, platform);
    if (found !== null) return found;
  }

  if (platform === "darwin") {
    const home = env.HOME ?? "";
    // Known installer locations are meaningful only below an absolute user
    // home. A relative or control-character-bearing HOME would otherwise make
    // the server's current working directory part of executable discovery.
    if (path.isAbsolute(home) && !/[\0\r\n]/.test(home)) {
      for (const candidate of [
        // International edition
        path.join(home, ".local", "bin", "qodercli"),
        path.join(home, ".qoder", "bin", "qodercli", "qodercli"),
        path.join(home, ".qoder", "entry", "qoder"),
        // China edition (#200)
        path.join(home, ".local", "bin", "qoderclicn"),
        path.join(home, ".qoder-cn", "bin", "qoderclicn", "qoderclicn"),
        path.join(home, ".qoder-cn", "entry", "qodercn"),
        path.join(home, ".qoder-cn", "entry", "qoder-cn"),
      ]) {
        const found = executableTarget(candidate);
        if (found !== null) return found;
      }
    }
  }
  return null;
}
