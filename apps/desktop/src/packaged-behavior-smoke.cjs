const {
  packagedSmokeRequest,
  writeSmokeReport,
} = require("./packaged-smoke.cjs");

// #111 behavior qualification is intentionally separate from Lane A static smoke.
// It exercises renderer/preload, recovered PATH, bundled Qoder/MCP, a real fixture
// turn, and durable history readback without turning those claims into release proof.
const PACKAGED_BEHAVIOR_SMOKE_SCRIPT = String.raw`(async () => {
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

function packagedBehaviorSmokeRequest(env) {
  return packagedSmokeRequest({
    ORG_WORKBENCH_PACKAGED_SMOKE_NONCE:
      env.ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_NONCE,
    ORG_WORKBENCH_PACKAGED_SMOKE_REPORT:
      env.ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_REPORT,
    ORG_WORKBENCH_PACKAGED_SMOKE_ROOT:
      env.ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_ROOT,
  });
}

function safeError(error) {
  return String(error?.message ?? error)
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 512);
}

async function runPackagedBehaviorSmoke({
  reportRequest,
  webContents,
  serverPid,
  resourcesPath,
  quit,
}) {
  let report;
  try {
    const renderer = await webContents.executeJavaScript(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, true);
    report = {
      schemaVersion: "org-workbench-packaged-behavior-smoke.v1",
      ok: true,
      nonce: reportRequest.nonce,
      ...renderer,
      serverPid: Number.isInteger(serverPid) ? serverPid : null,
      resourcesPath,
    };
  } catch (error) {
    report = {
      schemaVersion: "org-workbench-packaged-behavior-smoke.v1",
      ok: false,
      nonce: reportRequest.nonce,
      error: safeError(error),
      serverPid: Number.isInteger(serverPid) ? serverPid : null,
      resourcesPath,
    };
  }
  writeSmokeReport(reportRequest, report);
  quit();
}

module.exports = {
  PACKAGED_BEHAVIOR_SMOKE_SCRIPT,
  packagedBehaviorSmokeRequest,
  runPackagedBehaviorSmoke,
};
