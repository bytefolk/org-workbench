const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PACKAGED_SMOKE_SCRIPT,
  createPackagedSmokeLifecycle,
  closeSmokeReportReservation,
  packagedSmokeLoadOptions,
  packagedSmokeRequest,
  startPackagedSmokeLifecycle,
  writeSmokeReport,
} = require("../src/packaged-smoke.cjs");
const {
  bindNativeProcessIdentity,
  descendantProcesses,
  listNativeProcesses,
  residualProcesses,
  selectCleanupCandidates,
  signalBoundProcess,
  terminateNativeProcessTree,
} = require("../packaging/process-tree.cjs");

const SMOKE_NONCE = "a".repeat(64);

function smokeEnv(root, report) {
  return {
    ORG_WORKBENCH_PACKAGED_SMOKE_ROOT: root,
    ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: report,
    ORG_WORKBENCH_PACKAGED_SMOKE_NONCE: SMOKE_NONCE,
  };
}

function disposeRequest(request) {
  if (request === null) return;
  try { fs.closeSync(request.reportFd); } catch {}
  try { fs.unlinkSync(request.report); } catch {}
}

test("renderer observation does not invoke health, Host, or business turns", () => {
  assert.match(PACKAGED_SMOKE_SCRIPT, /rendererEntryObserved/);
  assert.doesNotMatch(PACKAGED_SMOKE_SCRIPT, /owb\.status\s*\(/);
  assert.doesNotMatch(PACKAGED_SMOKE_SCRIPT, /createTurn|turnHistory|health/);
});

test("packaged smoke is opt-in and confined to an owned fresh temp root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "smoke-report.json");
  const request = packagedSmokeRequest(smokeEnv(root, report));
  assert.notEqual(request, null);
  assert.equal(request.root, fs.realpathSync(root));
  assert.equal(request.report, path.join(request.root, "smoke-report.json"));
  assert.equal(Number.isInteger(request.reportFd), true);
  assert.equal(request.nonce, SMOKE_NONCE);
  disposeRequest(request);
  assert.equal(packagedSmokeRequest({}), null);
  assert.equal(packagedSmokeRequest(smokeEnv(root, path.join(root, "..", "outside.json"))), null);
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  assert.equal(packagedSmokeRequest(smokeEnv(
    root,
    `${nested}${path.sep}..${path.sep}noncanonical.json`,
  )), null);

  fs.writeFileSync(report, "existing\n");
  assert.equal(packagedSmokeRequest(smokeEnv(root, report)), null);
});

test("packaged smoke rejects a symlinked staging root", (t) => {
  if (process.platform === "win32") {
    t.skip("creating directory symlinks requires elevated Windows policy");
    return;
  }
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  const link = `${target}-link`;
  t.after(() => {
    fs.rmSync(link, { force: true, recursive: true });
    fs.rmSync(target, { force: true, recursive: true });
  });
  fs.symlinkSync(target, link, "dir");
  assert.equal(packagedSmokeRequest(smokeEnv(link, path.join(link, "report.json"))), null);
});

test("smoke report uses an exclusive reservation and descriptor-bound write", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "report.json");
  const env = smokeEnv(root, report);
  const request = packagedSmokeRequest(env);
  assert.notEqual(request, null);
  assert.equal(packagedSmokeRequest(env), null, "reserved report path must not be reopened");
  writeSmokeReport(request, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(report, "utf8")), { ok: true });
  assert.throws(() => writeSmokeReport(request, { ok: false }));
});

test("load failure cleanup cannot close a reused descriptor number", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const request = packagedSmokeRequest(smokeEnv(root, path.join(root, "report.json")));
  assert.notEqual(request, null);
  const reservedFd = request.reportFd;
  closeSmokeReportReservation(request);
  assert.equal(request.reportFd, null);

  const sentinel = path.join(root, "reused-fd.txt");
  const reusedFd = fs.openSync(sentinel, "wx", 0o600);
  t.after(() => {
    try { fs.closeSync(reusedFd); } catch {}
  });
  assert.equal(reusedFd, reservedFd, "fixture must exercise OS descriptor-number reuse");
  closeSmokeReportReservation(request);
  fs.writeFileSync(reusedFd, "still-open\n");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "still-open\n");
});

test("descriptor-bound report fails closed after a parent directory swap", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows can deny renaming a directory containing an open file");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  const report = path.join(root, "report.json");
  const request = packagedSmokeRequest(smokeEnv(root, report));
  assert.notEqual(request, null);
  const movedRoot = `${request.root}-original`;
  t.after(() => {
    disposeRequest(request);
    fs.rmSync(request.root, { force: true, recursive: true });
    fs.rmSync(movedRoot, { force: true, recursive: true });
  });
  fs.renameSync(request.root, movedRoot);
  fs.mkdirSync(request.root);

  assert.throws(
    () => writeSmokeReport(request, { ok: true }),
    /reservation changed|ENOENT/,
  );
  assert.equal(fs.existsSync(path.join(request.root, "report.json")), false);
  assert.equal(fs.readFileSync(path.join(movedRoot, "report.json"), "utf8"), "");
});

test("main-owned smoke nonce is required in both the file URL and report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "report.json");
  assert.equal(packagedSmokeRequest({
    ...smokeEnv(root, report),
    ORG_WORKBENCH_PACKAGED_SMOKE_NONCE: "predictable",
  }), null);

  const request = packagedSmokeRequest(smokeEnv(root, report));
  assert.notEqual(request, null);
  const load = packagedSmokeLoadOptions(path.join(root, "index.html"), request);
  const url = new URL(load.trustedRendererUrl);
  assert.equal(url.protocol, "file:");
  assert.equal(url.searchParams.get("orgWorkbenchPackagedSmoke"), SMOKE_NONCE);
  assert.deepEqual(load.loadOptions, {
    query: { orgWorkbenchPackagedSmoke: SMOKE_NONCE },
  });
  writeSmokeReport(request, { nonce: request.nonce, ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(report, "utf8")), {
    nonce: SMOKE_NONCE,
    ok: true,
  });
});

test("renderer failure after a report is still fatal until intentional close", () => {
  const failures = [];
  const request = { reportFd: null };
  const lifecycle = createPackagedSmokeLifecycle({
    reportRequest: request,
    onUnexpected: (error) => failures.push(error.message),
  });
  lifecycle.markReportWritten();
  assert.equal(lifecycle.unexpected("renderer crashed"), true);
  assert.match(failures[0], /failed after reporting: renderer crashed/);
  assert.equal(lifecycle.unexpected("duplicate"), false);

  const intentional = createPackagedSmokeLifecycle({
    reportRequest: request,
    onUnexpected: (error) => failures.push(error.message),
  });
  intentional.markReportWritten();
  intentional.beginIntentionalClose();
  assert.equal(intentional.unexpected("expected close"), false);
  assert.equal(failures.length, 1);
});

test("shared smoke lifecycle writes a nonce-bound failure report for every pre-report load failure", async (t) => {
  const cases = [
    {
      name: "did-fail-load",
      trigger: (window) => window.webContents.emit("did-fail-load", null, -3, "fixture load failure"),
      expectedStage: "renderer-load",
    },
    {
      name: "render-process-gone",
      trigger: (window) => window.webContents.emit("render-process-gone", null, { reason: "crashed" }),
      expectedStage: "renderer-process",
    },
    {
      name: "early closed",
      trigger: (window) => window.emit("closed"),
      expectedStage: "window-closed",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
      t.after(() => fs.rmSync(root, { force: true, recursive: true }));
      const request = packagedSmokeRequest(smokeEnv(root, path.join(root, "lifecycle.json")));
      assert.notEqual(request, null);
      const window = new EventEmitter();
      window.webContents = new EventEmitter();
      const failures = [];
      startPackagedSmokeLifecycle({
        browserWindow: window,
        reportRequest: request,
        failureReport: () => ({ schemaVersion: "fixture.v1" }),
        load: () => new Promise(() => {}),
        run: () => assert.fail("failed load must not run smoke"),
        onUnexpected: (error) => failures.push(error.message),
      });

      fixture.trigger(window);
      const report = JSON.parse(fs.readFileSync(request.report, "utf8"));
      assert.equal(report.schemaVersion, "fixture.v1");
      assert.equal(report.ok, false);
      assert.equal(report.nonce, SMOKE_NONCE);
      assert.equal(report.stage, fixture.expectedStage);
      assert.equal(request.reportFd, null);
      assert.equal(failures.length, 1);
    });
  }
});

test("shared smoke lifecycle catches load rejection and duplicate events cannot reuse its fd", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const request = packagedSmokeRequest(smokeEnv(root, path.join(root, "load-rejection.json")));
  assert.notEqual(request, null);
  const reservedFd = request.reportFd;
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  const failures = [];
  startPackagedSmokeLifecycle({
    browserWindow: window,
    reportRequest: request,
    failureReport: () => ({ schemaVersion: "fixture.v1" }),
    load: () => Promise.reject(new Error("fixture load rejection")),
    run: () => assert.fail("rejected load must not run smoke"),
    onUnexpected: (error) => failures.push(error.message),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const report = JSON.parse(fs.readFileSync(request.report, "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.nonce, SMOKE_NONCE);
  assert.equal(report.stage, "renderer-load-promise");
  assert.equal(request.reportFd, null);
  assert.equal(failures.length, 1);

  const sentinelPath = path.join(root, "reused-after-lifecycle.txt");
  const reusedFd = fs.openSync(sentinelPath, "wx", 0o600);
  t.after(() => {
    try { fs.closeSync(reusedFd); } catch {}
  });
  assert.equal(reusedFd, reservedFd, "fixture must exercise descriptor-number reuse");
  window.webContents.emit("render-process-gone", null, { reason: "duplicate" });
  window.emit("closed");
  fs.writeFileSync(reusedFd, "still-open\n");
  assert.equal(fs.readFileSync(sentinelPath, "utf8"), "still-open\n");
  assert.equal(failures.length, 1);
});

test("shared smoke lifecycle rejects a post-report crash until intentional close", async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  const failures = [];
  let lifecycle = null;
  lifecycle = startPackagedSmokeLifecycle({
    browserWindow: window,
    reportRequest: { reportFd: null },
    failureReport: () => assert.fail("a completed report must not be rewritten"),
    load: () => Promise.resolve(),
    run: async () => {
      lifecycle.markReportWritten();
    },
    onUnexpected: (error) => failures.push(error.message),
  });
  window.webContents.emit("did-finish-load");
  await new Promise((resolve) => setImmediate(resolve));
  window.webContents.emit("render-process-gone", null, { reason: "crashed-after-report" });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /after reporting/);

  const intentionalWindow = new EventEmitter();
  intentionalWindow.webContents = new EventEmitter();
  const intentional = startPackagedSmokeLifecycle({
    browserWindow: intentionalWindow,
    reportRequest: { reportFd: null },
    failureReport: () => assert.fail("intentional close must not write a report"),
    load: () => Promise.resolve(),
    run: () => {},
    onUnexpected: (error) => failures.push(error.message),
  });
  intentional.markReportWritten();
  intentional.beginIntentionalClose();
  intentionalWindow.emit("closed");
  assert.equal(failures.length, 1);
});

test("process oracle follows descendants and detects tracked or staged residuals", () => {
  const processes = [
    { pid: 10, ppid: 1, pgid: 10, startTime: "t1", executable: "/app", command: "/tmp/owb-clean-staging-a/Org Workbench" },
    { pid: 11, ppid: 10, pgid: 10, startTime: "t2", executable: "/app", command: "server" },
    { pid: 12, ppid: 11, pgid: 10, startTime: "t3", executable: "/app", command: "qoder-engine --version" },
    { pid: 99, ppid: 1, pgid: 99, startTime: "t4", executable: "/other", command: "unrelated" },
    { pid: 100, ppid: 1, pgid: 100, startTime: "t5", executable: "/other", command: "/tmp/owb-clean-staging-a-copy/sentinel" },
  ];
  assert.deepEqual(descendantProcesses(processes, 10).map(({ pid }) => pid), [11, 12]);
  assert.deepEqual(
    residualProcesses(processes, {
      stagingRoot: "/tmp/owb-clean-staging-a",
      trackedProcesses: processes.slice(0, 3),
    }).map(({ pid }) => pid),
    [10, 11, 12],
  );
});

test("live-root ownership excludes same-command and path-prefix sentinels", () => {
  const stagingRoot = "/tmp/owb-clean-staging-owned";
  const rootIdentity = {
    pid: 100,
    ppid: 1,
    pgid: 100,
    startTime: "owned-root",
    executable: "/owned/app",
    command: `${stagingRoot}/Org Workbench`,
  };
  const inventory = [
    rootIdentity,
    { pid: 101, ppid: 100, pgid: 100, startTime: "owned-child", executable: "/owned/server", command: "server" },
    { pid: 200, ppid: 1, pgid: 200, startTime: "spoof", executable: "/unrelated/node", command: `${stagingRoot}/Org Workbench` },
    { pid: 201, ppid: 1, pgid: 201, startTime: "prefix", executable: "/unrelated/node", command: `${stagingRoot}-copy/Org Workbench` },
  ];

  assert.deepEqual(
    selectCleanupCandidates(inventory, {
      rootIdentity,
      originPid: rootIdentity.pid,
      stagingRoot,
      processGroup: rootIdentity.pgid,
      nativePlatform: "darwin",
    }).map(({ pid }) => pid),
    [100, 101],
  );
  assert.deepEqual(
    residualProcesses(inventory, {
      stagingRoot,
      trackedProcesses: [rootIdentity, inventory[1]],
      processGroup: rootIdentity.pgid,
    }).map(({ pid }) => pid),
    [100, 101],
  );
});

test("Windows null-root ownership never falls back to staging command text", () => {
  const stagingRoot = "C:\\Temp\\owb-clean-staging-owned";
  const known = {
    pid: 300,
    ppid: 1,
    pgid: null,
    startTime: "known",
    executable: "C:\\owned\\server.exe",
    command: "server",
  };
  const inventory = [
    known,
    { pid: 301, ppid: 1, pgid: null, startTime: "spoof", executable: "C:\\other\\node.exe", command: `${stagingRoot}\\Org Workbench.exe` },
  ];
  assert.deepEqual(
    selectCleanupCandidates(inventory, {
      rootIdentity: null,
      originPid: 299,
      stagingRoot,
      knownIdentities: [known],
      nativePlatform: "win32",
    }).map(({ pid }) => pid),
    [300],
  );
});

test("a reused POSIX origin generation cannot inherit PGID ownership", () => {
  const staleRoot = {
    pid: 400,
    ppid: 1,
    pgid: 400,
    startTime: "old-generation",
    executable: "/owned/app",
    command: "/owned/app",
  };
  const reused = {
    ...staleRoot,
    startTime: "new-generation",
    executable: "/unrelated/app",
    command: "/unrelated/app",
  };
  assert.deepEqual(
    selectCleanupCandidates([reused], {
      rootIdentity: staleRoot,
      originPid: staleRoot.pid,
      stagingRoot: "/tmp/owb-clean-staging-owned",
      processGroup: staleRoot.pgid,
      nativePlatform: "darwin",
    }),
    [],
  );
});

test("termination APIs reject raw process ids", async () => {
  await assert.rejects(
    terminateNativeProcessTree(process.pid, "/tmp/not-a-staging-root"),
    /bound identity, never a raw PID/,
  );
});

test("null-root provenance selects only its orphaned POSIX group while the origin PID is absent", () => {
  const stagingRoot = "/tmp/owb-clean-staging-reused-origin";
  const expectedGroup = 4100;
  const sameCommand = `${stagingRoot}/Org Workbench`;
  const inventory = [
    {
      pid: 4200,
      ppid: 1,
      pgid: expectedGroup,
      startTime: "owned-orphan",
      executable: "/owned/node",
      command: sameCommand,
    },
    {
      pid: 4300,
      ppid: 1,
      pgid: 4300,
      startTime: "sentinel",
      executable: "/unrelated/node",
      command: "sentinel",
    },
  ];

  assert.deepEqual(
    selectCleanupCandidates(inventory, {
      rootIdentity: null,
      originPid: expectedGroup,
      stagingRoot,
      processGroup: expectedGroup,
      nativePlatform: "darwin",
    }).map(({ pid }) => pid),
    [4200],
  );
});

test("null-root provenance rejects the expected PGID after origin PID reuse", () => {
  const originPid = 4100;
  const inventory = [
    {
      pid: originPid,
      ppid: 1,
      pgid: 9000,
      startTime: "reused-origin",
      executable: "/unrelated/node",
      command: "/unrelated/node",
    },
    {
      pid: 4200,
      ppid: 1,
      pgid: originPid,
      startTime: "old-group-orphan",
      executable: "/owned/node",
      command: "/owned/node",
    },
  ];
  assert.deepEqual(
    selectCleanupCandidates(inventory, {
      rootIdentity: null,
      originPid,
      stagingRoot: "/tmp/owb-clean-staging-reused-origin",
      processGroup: originPid,
      nativePlatform: "darwin",
    }),
    [],
  );
});

test("PID reuse is neither residual evidence nor a signal target for an unrelated sentinel", async (t) => {
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  const closed = once(sentinel, "close");
  t.after(() => {
    try { sentinel.kill("SIGKILL"); } catch {}
  });
  let currentSentinel = null;
  for (let attempt = 0; attempt < 40 && currentSentinel === null; attempt += 1) {
    currentSentinel = listNativeProcesses().find(({ pid }) => pid === sentinel.pid) ?? null;
    if (currentSentinel === null) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const boundSentinel = bindNativeProcessIdentity(currentSentinel);
  assert.notEqual(boundSentinel, null);
  const startTimeReuse = {
    ...boundSentinel,
    startTime: `${boundSentinel.startTime}-reused`,
  };
  const executableMutation = {
    ...boundSentinel,
    executable: "/unrelated/process",
    command: "unrelated",
  };
  assert.deepEqual(
    residualProcesses([startTimeReuse], {
      stagingRoot: "/definitely/not/in/command",
      trackedProcesses: [boundSentinel],
    }),
    [],
  );
  await assert.rejects(
    terminateNativeProcessTree(startTimeReuse, "/definitely/not/in/command", {
      originPid: boundSentinel.pid,
      processGroup: process.platform === "win32" ? null : boundSentinel.pgid,
    }),
    /unbound|reused/,
  );
  await assert.rejects(
    terminateNativeProcessTree(executableMutation, "/definitely/not/in/command", {
      originPid: boundSentinel.pid,
      processGroup: process.platform === "win32" ? null : boundSentinel.pgid,
    }),
    /identity changed/,
  );
  assert.equal(signalBoundProcess(startTimeReuse, "SIGTERM"), false);
  assert.equal(signalBoundProcess(executableMutation, "SIGTERM"), false);
  assert.doesNotThrow(() => process.kill(sentinel.pid, 0), "mismatched identity must leave sentinel alive");
  assert.equal(signalBoundProcess(boundSentinel, "SIGKILL"), true);
  await closed;
});

test("failure cleanup escalates a SIGTERM-trapping child to SIGKILL", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows uses creation/executable-bound process handles in its native staging job");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000)",
  ], { cwd: root, detached: true, stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => {
    try { child.kill("SIGKILL"); } catch {}
    fs.rmSync(root, { force: true, recursive: true });
  });
  await once(child.stdout, "data");
  const identity = bindNativeProcessIdentity(
    listNativeProcesses().find(({ pid }) => pid === child.pid),
  );
  assert.notEqual(identity, null);
  const closed = once(child, "close");
  await terminateNativeProcessTree(identity, root);
  const [, signal] = await closed;
  assert.equal(signal, "SIGKILL");
  assert.equal(
    residualProcesses(listNativeProcesses(), { stagingRoot: root, trackedProcesses: [identity] }).length,
    0,
  );
});

test("real cleanup leaves a live same-path command sentinel untouched", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX signal fixture; Windows ownership remains native-CI NOT VERIFIED");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  const sentinel = spawn(process.execPath, [
    "-e",
    "process.stdout.write('sentinel-ready\\n'); setInterval(()=>{},1000)",
    `${root}/Org Workbench`,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const owned = spawn(process.execPath, [
    "-e",
    "process.stdout.write('owned-ready\\n'); setInterval(()=>{},1000)",
  ], { cwd: root, detached: true, stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => {
    try { sentinel.kill("SIGKILL"); } catch {}
    try { owned.kill("SIGKILL"); } catch {}
    fs.rmSync(root, { force: true, recursive: true });
  });
  await Promise.all([once(sentinel.stdout, "data"), once(owned.stdout, "data")]);
  const identity = bindNativeProcessIdentity(
    listNativeProcesses().find(({ pid }) => pid === owned.pid),
  );
  assert.notEqual(identity, null);

  await terminateNativeProcessTree(identity, root);
  assert.doesNotThrow(
    () => process.kill(sentinel.pid, 0),
    "same-path command sentinel must remain alive",
  );
});

test("cleanup binds and kills a TERM-spawned reparented group member", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows has no POSIX TERM handler; bound-handle kill is covered natively");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  const pidFile = path.join(root, "spawned.pid");
  const child = spawn(process.execPath, [
    "-e",
    [
      "const {spawn}=require('node:child_process'),fs=require('node:fs')",
      "process.on('SIGTERM',()=>{",
      "const escaped=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
      "fs.writeFileSync(process.env.PID_FILE,String(escaped.pid))",
      "setTimeout(()=>process.exit(0),50)",
      "})",
      "process.stdout.write('ready\\n')",
      "setInterval(()=>{},1000)",
    ].join(";"),
  ], {
    cwd: root,
    detached: true,
    env: { ...process.env, PID_FILE: pidFile },
    stdio: ["ignore", "pipe", "ignore"],
  });
  t.after(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    fs.rmSync(root, { force: true, recursive: true });
  });
  await once(child.stdout, "data");
  const identity = bindNativeProcessIdentity(
    listNativeProcesses().find(({ pid }) => pid === child.pid),
  );
  assert.notEqual(identity, null);

  await terminateNativeProcessTree(identity, root);
  const escapedPid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.equal(Number.isInteger(escapedPid), true);
  assert.throws(() => process.kill(escapedPid, 0), { code: "ESRCH" });
});
