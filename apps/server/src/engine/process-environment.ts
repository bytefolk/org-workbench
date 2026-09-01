const RUNTIME_EXECUTABLE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SHELL",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
] as const;

export function bundledElectronRunAsNode(
  source: NodeJS.ProcessEnv,
  bundledElectronEngine: boolean,
): "1" | undefined {
  return bundledElectronEngine && source.ELECTRON_RUN_AS_NODE === "1"
    ? "1"
    : undefined;
}

/**
 * Environment for the configured digital-employee command boundary.
 *
 * This general control-plane boundary intentionally carries no provider
 * credential, Context authority, or arbitrary operator configuration. The
 * exact Electron switch is added only for the desktop-owned bundled adapter,
 * whose executable is Electron itself; selected-engine turn credentials are
 * handled by the narrower turn environment contract instead.
 */
export function engineCliEnvironment(
  source: NodeJS.ProcessEnv,
  bundledElectronEngine: boolean,
): NodeJS.ProcessEnv {
  const environment = runtimeExecutableEnvironment(source);
  const runAsNode = bundledElectronRunAsNode(source, bundledElectronEngine);
  if (runAsNode !== undefined) environment.ELECTRON_RUN_AS_NODE = runAsNode;
  return environment;
}

/** Minimal non-credential environment for real Host executable probes. */
export function runtimeExecutableEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of RUNTIME_EXECUTABLE_ENV_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  return environment;
}
