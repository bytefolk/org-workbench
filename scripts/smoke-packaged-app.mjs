import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackagedApp } from "./verify-packaged-app.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceApp = path.resolve(process.argv[2] ?? path.join(projectRoot, "release", "mac-arm64", "Org Workbench.app"));
const packageReport = verifyPackagedApp(sourceApp);
const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "owb-package-smoke-"));
let completed = false;

function executableScript(body) {
  return `#!/bin/sh\nset -eu\n${body}\n`;
}

async function writeExecutable(file, body) {
  await fs.writeFile(file, executableScript(body), { encoding: "utf8", mode: 0o700 });
}

async function waitForPidExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
  }
  throw new Error(`packaged control plane still running after app exit (pid ${pid})`);
}

async function runApp(binary, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { cwd: stagingRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk) => {
      output = (output + String(chunk)).slice(-65536);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      reject(new Error(`packaged app smoke timed out\n${output}`));
    }, 45000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`packaged app exited ${code ?? signal}\n${output}`));
      else resolve(output);
    });
  });
}

try {
  const appPath = path.join(stagingRoot, "Org Workbench.app");
  await fs.cp(sourceApp, appPath, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  const resources = path.join(appPath, "Contents", "Resources", "app");
  const workspace = path.join(stagingRoot, "workspace");
  await fs.cp(path.join(resources, "examples", "oss-maintainer"), workspace, { recursive: true });

  const smokeBin = path.join(stagingRoot, "login-bin");
  const tempDir = path.join(stagingRoot, "tmp");
  const homeDir = path.join(stagingRoot, "home");
  await Promise.all([
    fs.mkdir(smokeBin, { recursive: true }),
    fs.mkdir(tempDir, { recursive: true }),
    fs.mkdir(homeDir, { recursive: true }),
  ]);

  const mcpBin = path.join(smokeBin, "owb-mcp-smoke");
  await writeExecutable(mcpBin, `
if [ "\${ELECTRON_RUN_AS_NODE:-}" != "" ]; then exit 45; fi
if [ "\${OWB_LOGIN_ONLY_SECRET:-}" != "" ]; then exit 46; fi
exit 0
`);
  const qoderBin = path.join(smokeBin, "qodercli");
  const qoderAlias = path.join(smokeBin, "qoder");
  const qoderPidFile = path.join(tempDir, "qoder.pid");
  const qoderScript = `
qoder_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\\n' "$$" > "$qoder_dir/../tmp/qoder.pid"
if [ "\${ELECTRON_RUN_AS_NODE:-}" != "" ]; then
  exit 44
fi
if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' 'qoder 1.1.0'
  exit 0
fi
if [ "\${OWB_LOGIN_ONLY_SECRET:-}" != "" ]; then
  exit 43
fi
if ! owb-mcp-smoke; then
  exit 42
fi
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"packaged path smoke ok"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"packaged path smoke ok","usage":{"input_tokens":1,"output_tokens":1}}'
`;
  await writeExecutable(qoderBin, qoderScript);
  await writeExecutable(qoderAlias, qoderScript);
  const loginShell = path.join(stagingRoot, "login-shell");
  await writeExecutable(loginShell, `
OWB_LOGIN_ONLY_SECRET='must-not-cross'
export OWB_LOGIN_ONLY_SECRET
printf '%s\\n' '__ORG_WORKBENCH_LOGIN_PATH__=${smokeBin}:/usr/bin:/bin:/usr/sbin:/sbin'
`);

  const reportPath = path.join(tempDir, "report.json");
  const binary = path.join(appPath, "Contents", "MacOS", "Org Workbench");
  const launchEnv = {
    HOME: homeDir,
    LANG: "en_US.UTF-8",
    LOGNAME: "org-workbench-smoke",
    ORG_WORKBENCH_DEFAULT_WORKSPACE: workspace,
    ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: reportPath,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: loginShell,
    TMPDIR: tempDir,
    USER: "org-workbench-smoke",
  };
  await runApp(binary, launchEnv);

  const smoke = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(smoke.schemaVersion, "org-workbench-packaged-smoke.v1");
  assert.equal(smoke.ok, true, smoke.error ?? "packaged smoke failed");
  for (const key of [
    "rendererMounted",
    "preloadBridge",
    "localStorageRoundTrip",
    "controlPlaneReady",
    "engineAvailable",
    "qoderReady",
    "workspaceOpen",
    "turnCompleted",
    "historyReadback",
  ]) {
    assert.equal(smoke[key], true, `packaged smoke did not prove ${key}`);
  }
  assert.equal(
    await fs.realpath(smoke.resourcesPath),
    await fs.realpath(path.join(appPath, "Contents", "Resources")),
  );
  assert.equal(Number.isInteger(smoke.serverPid), true);
  const qoderPid = Number.parseInt((await fs.readFile(qoderPidFile, "utf8")).trim(), 10);
  assert.equal(Number.isInteger(qoderPid) && qoderPid > 1, true);
  await waitForPidExit(qoderPid);
  await waitForPidExit(smoke.serverPid);
  completed = true;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "org-workbench-clean-staging-smoke.v1",
    ok: true,
    appPath: packageReport.appPath,
    stagedOutsideSourceTree: !appPath.startsWith(`${projectRoot}${path.sep}`),
    launchPathWasMinimal: true,
    nestedMcpResolvedViaRecoveredPath: true,
    loginShellEnvironmentImported: false,
    rendererMounted: smoke.rendererMounted,
    controlPlaneReady: smoke.controlPlaneReady,
    qoderReady: smoke.qoderReady,
    turnCompleted: smoke.turnCompleted,
    historyReadback: smoke.historyReadback,
    residualControlPlane: false,
    residualQoder: false,
  })}\n`);
} finally {
  if (completed) await fs.rm(stagingRoot, { force: true, recursive: true });
  else process.stderr.write(`packaged smoke staging preserved for diagnosis: ${stagingRoot}\n`);
}
