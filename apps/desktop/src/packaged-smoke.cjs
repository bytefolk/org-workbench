const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PACKAGED_SMOKE_SCRIPT = String.raw`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (document.querySelector("#root")?.childElementCount > 0) break;
    await sleep(100);
  }
  const rendererMounted = document.querySelector("#root")?.childElementCount > 0;
  const preloadBridge = typeof window.owb?.status === "function" &&
    typeof window.owb?.createTurn === "function" &&
    typeof window.owb?.turnHistory === "function";
  if (!rendererMounted || !preloadBridge) throw new Error("renderer or preload bridge did not become ready");

  localStorage.setItem("owb-packaged-smoke", "ok");
  const localStorageRoundTrip = localStorage.getItem("owb-packaged-smoke") === "ok";
  localStorage.removeItem("owb-packaged-smoke");
  if (!localStorageRoundTrip) throw new Error("renderer localStorage roundtrip failed");

  const status = await window.owb.status();
  if (status?.running !== true || status?.health?.status !== "ok") {
    throw new Error("control plane health did not become ready");
  }
  const workspace = await window.owb.workspace();
  if (workspace?.status !== 200 || workspace?.body?.open !== true) {
    throw new Error("packaged workspace did not open");
  }

  const created = await window.owb.createTurn({
    positionId: "repo-owner",
    input: "Verify packaged PATH propagation.",
    engine: "qoder",
  });
  if (
    created?.status !== 200 ||
    created?.body?.status !== "completed" ||
    created?.body?.output !== "packaged path smoke ok"
  ) {
    throw new Error("packaged Qoder/MCP PATH turn did not complete");
  }
  const history = await window.owb.turnHistory("repo-owner");
  const persisted = history?.status === 200 && history?.body?.turns?.some(
    (turn) => turn?.turnId === created.body.turnId &&
      turn?.status === "completed" &&
      turn?.output === "packaged path smoke ok",
  );
  if (!persisted) throw new Error("packaged turn did not survive history readback");

  return {
    rendererMounted,
    preloadBridge,
    localStorageRoundTrip,
    controlPlaneReady: true,
    engineAvailable: status.health.engine?.available === true,
    qoderReady: status.health.hosts?.qoder?.ready === true,
    workspaceOpen: true,
    turnCompleted: true,
    historyReadback: true,
  };
})()`;

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length === 0 || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function packagedSmokeReportPath(env, tempRoot = os.tmpdir()) {
  const candidate = env.ORG_WORKBENCH_PACKAGED_SMOKE_REPORT;
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    candidate.includes("\0") ||
    /[\r\n]/.test(candidate) ||
    fs.existsSync(candidate)
  ) {
    return null;
  }
  try {
    const realRoot = fs.realpathSync(tempRoot);
    const realParent = fs.realpathSync(path.dirname(candidate));
    if (!isWithin(realRoot, realParent)) return null;
    return path.resolve(candidate) === candidate ? candidate : null;
  } catch {
    return null;
  }
}

function safeError(error) {
  return String(error?.message ?? error)
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 512);
}

async function runPackagedSmoke({ reportPath, webContents, serverPid, resourcesPath, quit }) {
  let report;
  try {
    const renderer = await webContents.executeJavaScript(PACKAGED_SMOKE_SCRIPT, true);
    report = {
      schemaVersion: "org-workbench-packaged-smoke.v1",
      ok: true,
      ...renderer,
      serverPid: Number.isInteger(serverPid) ? serverPid : null,
      resourcesPath,
    };
  } catch (error) {
    report = {
      schemaVersion: "org-workbench-packaged-smoke.v1",
      ok: false,
      error: safeError(error),
      serverPid: Number.isInteger(serverPid) ? serverPid : null,
      resourcesPath,
    };
  }
  try {
    fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } finally {
    quit();
  }
}

module.exports = {
  PACKAGED_SMOKE_SCRIPT,
  packagedSmokeReportPath,
  runPackagedSmoke,
};
