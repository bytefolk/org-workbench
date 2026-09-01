const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PACKAGED_SMOKE_SCRIPT = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (document.querySelector("#root")?.childElementCount > 0) break;
    await sleep(50);
  }
  const smokeEntry = document.querySelector("[data-org-workbench-packaged-smoke-entry='true']");
  const rendererMounted = document.querySelector("#root")?.childElementCount > 0;
  const rendererEntryObserved = location.protocol === "file:" && /\/index\.html$/.test(location.pathname);
  const preloadBridge = typeof window.owb?.status === "function";
  if (!rendererMounted || !rendererEntryObserved || !preloadBridge || smokeEntry === null) {
    throw new Error("renderer entry or preload bridge did not become ready");
  }
  return {
    rendererMounted,
    rendererEntryObserved,
    preloadBridge,
    staticSmokeEntry: true,
  };
})()`;

const PACKAGED_SMOKE_QUERY_KEY = "orgWorkbenchPackagedSmoke";
const NONCE_PATTERN = /^[a-f0-9]{64}$/;

function isDirectChild(root, candidate) {
  return path.dirname(path.resolve(candidate)) === path.resolve(root);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function closeQuietly(fd) {
  if (!Number.isInteger(fd)) return;
  try {
    fs.closeSync(fd);
  } catch {}
}

function closeSmokeReportReservation(request) {
  if (!Number.isInteger(request?.reportFd)) return;
  const reportFd = request.reportFd;
  // Invalidate before close. BrowserWindow failure/gone/closed events may all
  // fire, and closing the same integer after OS reuse could close an unrelated
  // descriptor in Electron.
  request.reportFd = null;
  closeQuietly(reportFd);
}

function assertReservedReport(request) {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.root !== "string" ||
    typeof request.report !== "string" ||
    !Number.isInteger(request.reportFd)
  ) {
    throw new Error("invalid packaged smoke report reservation");
  }
  const rootStat = fs.lstatSync(request.root);
  const reportStat = fs.lstatSync(request.report);
  const openedStat = fs.fstatSync(request.reportFd);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    reportStat.isSymbolicLink() ||
    !reportStat.isFile() ||
    !openedStat.isFile() ||
    !sameFileIdentity(rootStat, request.rootStat) ||
    !sameFileIdentity(reportStat, openedStat) ||
    fs.realpathSync(request.root) !== request.root ||
    fs.realpathSync(path.dirname(request.report)) !== request.root ||
    !isDirectChild(request.root, request.report)
  ) {
    throw new Error("packaged smoke report reservation changed");
  }
}

function packagedSmokeRequest(env, tempRoot = os.tmpdir()) {
  const requestedRoot = env.ORG_WORKBENCH_PACKAGED_SMOKE_ROOT;
  const report = env.ORG_WORKBENCH_PACKAGED_SMOKE_REPORT;
  const nonce = env.ORG_WORKBENCH_PACKAGED_SMOKE_NONCE;
  if (
    typeof requestedRoot !== "string" ||
    typeof report !== "string" ||
    typeof nonce !== "string" ||
    !NONCE_PATTERN.test(nonce) ||
    !path.isAbsolute(requestedRoot) ||
    !path.isAbsolute(report) ||
    path.resolve(requestedRoot) !== requestedRoot ||
    path.resolve(report) !== report ||
    /[\0\r\n]/.test(requestedRoot) ||
    /[\0\r\n]/.test(report) ||
    !path.basename(requestedRoot).startsWith("owb-clean-staging-") ||
    !isDirectChild(requestedRoot, report)
  ) {
    return null;
  }
  let reportFd = null;
  let openedStat = null;
  let reservedReport = report;
  try {
    const rootStat = fs.lstatSync(requestedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    const realRoot = fs.realpathSync(requestedRoot);
    const realTemp = fs.realpathSync(tempRoot);
    if (path.dirname(realRoot) !== realTemp || fs.existsSync(report)) return null;
    if (fs.realpathSync(path.dirname(report)) !== realRoot) return null;
    reservedReport = path.join(realRoot, path.basename(report));
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    reportFd = fs.openSync(
      reservedReport,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        noFollow,
      0o600,
    );
    openedStat = fs.fstatSync(reportFd);
    const request = { root: realRoot, report: reservedReport, reportFd, rootStat, nonce };
    // Recheck after the exclusive reservation. A parent rename/swap between
    // validation and open cannot redirect the later write: it is bound to fd.
    assertReservedReport(request);
    return request;
  } catch {
    closeQuietly(reportFd);
    if (openedStat !== null) {
      try {
        const pathStat = fs.lstatSync(reservedReport);
        if (sameFileIdentity(pathStat, openedStat)) fs.unlinkSync(reservedReport);
      } catch {}
    }
    return null;
  }
}

function packagedSmokeLoadOptions(entryPath, request) {
  if (!request || !NONCE_PATTERN.test(request.nonce ?? "")) {
    throw new Error("packaged smoke load requires a reserved nonce");
  }
  const entryUrl = pathToFileURL(path.resolve(entryPath));
  entryUrl.searchParams.set(PACKAGED_SMOKE_QUERY_KEY, request.nonce);
  return {
    trustedRendererUrl: entryUrl.toString(),
    loadOptions: { query: { [PACKAGED_SMOKE_QUERY_KEY]: request.nonce } },
  };
}

function createPackagedSmokeLifecycle({ reportRequest, onUnexpected }) {
  let intentionalClose = false;
  let failed = false;
  let reportWritten = false;
  return {
    beginIntentionalClose() {
      intentionalClose = true;
    },
    markReportWritten() {
      reportWritten = true;
    },
    unexpected(reason) {
      if (intentionalClose || failed) return false;
      failed = true;
      closeSmokeReportReservation(reportRequest);
      onUnexpected(new Error(
        `packaged smoke lifecycle failed${reportWritten ? " after reporting" : ""}: ${safeError(reason)}`,
      ));
      return true;
    },
    state() {
      return { failed, intentionalClose, reportWritten };
    },
  };
}

function safeError(error) {
  return String(error?.message ?? error)
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 512);
}

function writeSmokeReport(request, report) {
  try {
    assertReservedReport(request);
    fs.writeFileSync(request.reportFd, `${JSON.stringify(report)}\n`, {
      encoding: "utf8",
    });
    fs.fsyncSync(request.reportFd);
  } finally {
    closeSmokeReportReservation(request);
  }
}

async function runPackagedSmoke({
  reportRequest,
  webContents,
  appPid,
  serverPid,
  serverPort,
  resourcesPath,
  onReportWritten = () => {},
  close,
}) {
  let report;
  try {
    const renderer = await webContents.executeJavaScript(PACKAGED_SMOKE_SCRIPT, false);
    if (!Number.isInteger(serverPid) || !Number.isInteger(serverPort) || serverPort < 1) {
      throw new Error("control plane ready line was not observed");
    }
    report = {
      schemaVersion: "org-workbench-packaged-smoke.v1",
      ok: true,
      nonce: reportRequest.nonce,
      ...renderer,
      controlPlaneReady: true,
      appPid,
      serverPid,
      serverPort,
      resourcesPath,
    };
  } catch (error) {
    report = {
      schemaVersion: "org-workbench-packaged-smoke.v1",
      ok: false,
      nonce: reportRequest.nonce,
      error: safeError(error),
      appPid,
      serverPid: Number.isInteger(serverPid) ? serverPid : null,
      resourcesPath,
    };
  }
  writeSmokeReport(reportRequest, report);
  onReportWritten();
  close();
}

module.exports = {
  PACKAGED_SMOKE_SCRIPT,
  PACKAGED_SMOKE_QUERY_KEY,
  closeSmokeReportReservation,
  createPackagedSmokeLifecycle,
  packagedSmokeLoadOptions,
  packagedSmokeRequest,
  runPackagedSmoke,
  writeSmokeReport,
};
