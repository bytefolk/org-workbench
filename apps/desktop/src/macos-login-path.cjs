const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOGIN_PATH_MARKER = "__ORG_WORKBENCH_LOGIN_PATH__=";
const LOGIN_PATH_COMMAND = `printf '${LOGIN_PATH_MARKER}%s\\n' "$PATH"`;
const LOGIN_PATH_TIMEOUT_MS = 3000;
const LOGIN_PATH_MAX_BUFFER_BYTES = 8192;
const LOGIN_PATH_MAX_VALUE_BYTES = 4096;
const LOGIN_PATH_MAX_ENTRIES = 128;
const FALLBACK_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function originalPath(env) {
  return typeof env.PATH === "string" && env.PATH.length > 0
    ? env.PATH
    : FALLBACK_PATH;
}

function isExecutableShell(shellPath) {
  if (
    typeof shellPath !== "string" ||
    !path.posix.isAbsolute(shellPath) ||
    shellPath.includes("\0") ||
    /[\r\n]/.test(shellPath)
  ) {
    return false;
  }
  try {
    const stat = fs.statSync(shellPath);
    fs.accessSync(shellPath, fs.constants.X_OK);
    return stat.isFile();
  } catch {
    return false;
  }
}

function minimalShellEnv(env, shellPath, fallbackPath) {
  const allowed = {};
  for (const key of ["HOME", "LOGNAME", "USER"]) {
    if (typeof env[key] === "string") allowed[key] = env[key];
  }
  return {
    ...allowed,
    PATH: fallbackPath,
    SHELL: shellPath,
  };
}

function parseLoginPath(stdout) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > LOGIN_PATH_MAX_BUFFER_BYTES) {
    return null;
  }
  const lines = stdout.replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines.length !== 1 || !lines[0].startsWith(LOGIN_PATH_MARKER)) return null;
  const value = lines[0].slice(LOGIN_PATH_MARKER.length);
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > LOGIN_PATH_MAX_VALUE_BYTES ||
    value.includes("\0") ||
    /[\r\n]/.test(value)
  ) {
    return null;
  }
  const entries = value.split(":");
  if (
    entries.length === 0 ||
    entries.length > LOGIN_PATH_MAX_ENTRIES ||
    entries.some((entry) => entry.length === 0 || !path.posix.isAbsolute(entry))
  ) {
    return null;
  }
  return value;
}

/**
 * Restore only PATH for a Finder/LaunchServices-launched macOS process.
 *
 * The login shell receives a fixed command as an argv item (never interpolated
 * user input), a minimal environment, a hard timeout and an output cap. Any
 * ambiguity falls back to the PATH Electron already inherited.
 */
function recoverMacGuiPath({
  platform = process.platform,
  env = process.env,
  execFileImpl = execFile,
  isExecutableShell: shellCheck = isExecutableShell,
} = {}) {
  const fallbackPath = originalPath(env);
  if (platform !== "darwin") return Promise.resolve(fallbackPath);

  const shellPath = typeof env.SHELL === "string" && env.SHELL.length > 0
    ? env.SHELL
    : "/bin/zsh";
  if (!shellCheck(shellPath)) return Promise.resolve(fallbackPath);

  return new Promise((resolve) => {
    const settle = (error, stdout) => {
      if (error) {
        resolve(fallbackPath);
        return;
      }
      resolve(parseLoginPath(stdout) ?? fallbackPath);
    };
    try {
      execFileImpl(
        shellPath,
        ["-l", "-c", LOGIN_PATH_COMMAND],
        {
          encoding: "utf8",
          env: minimalShellEnv(env, shellPath, fallbackPath),
          killSignal: "SIGKILL",
          maxBuffer: LOGIN_PATH_MAX_BUFFER_BYTES,
          shell: false,
          timeout: LOGIN_PATH_TIMEOUT_MS,
          windowsHide: true,
        },
        settle,
      );
    } catch {
      resolve(fallbackPath);
    }
  });
}

module.exports = {
  LOGIN_PATH_COMMAND,
  LOGIN_PATH_MARKER,
  LOGIN_PATH_MAX_BUFFER_BYTES,
  LOGIN_PATH_TIMEOUT_MS,
  parseLoginPath,
  recoverMacGuiPath,
};
