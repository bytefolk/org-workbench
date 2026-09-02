const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  PACKAGED_BEHAVIOR_SMOKE_SCRIPT,
  packagedBehaviorSmokeRequest,
  reservePackagedSmokeRequests,
  runPackagedBehaviorSmoke,
} = require("../src/packaged-behavior-smoke.cjs");
const {
  closeSmokeReportReservation,
  packagedSmokeRequest,
  runPackagedSmoke,
} = require("../src/packaged-smoke.cjs");

const NONCE = "a".repeat(64);

function behaviorEnv(root, report) {
  return {
    ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_NONCE: NONCE,
    ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_REPORT: report,
    ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_ROOT: root,
  };
}

test("packaged behavior request is nonce-bound and confined to an owned fresh temp root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "behavior-report.json");
  const request = packagedBehaviorSmokeRequest(behaviorEnv(root, report));
  assert.notEqual(request, null);
  assert.equal(request.root, fs.realpathSync(root));
  assert.equal(request.report, path.join(request.root, "behavior-report.json"));
  assert.equal(request.nonce, NONCE);
  assert.equal(Number.isInteger(request.reportFd), true);
  closeSmokeReportReservation(request);

  assert.equal(packagedBehaviorSmokeRequest({}), null);
  assert.equal(packagedBehaviorSmokeRequest({
    ...behaviorEnv(root, path.join(root, "..", "outside.json")),
  }), null);
  assert.equal(packagedBehaviorSmokeRequest({
    ...behaviorEnv(root, report),
    ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_NONCE: "predictable",
  }), null);
});

test("packaged behavior request never overwrites an existing report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "behavior-report.json");
  fs.writeFileSync(report, "existing\n");
  assert.equal(packagedBehaviorSmokeRequest(behaviorEnv(root, report)), null);
});

test("dual smoke control families fail before any report reservation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const fixtures = [
    {
      name: "same report path",
      staticReport: path.join(root, "same-report.json"),
      behaviorReport: path.join(root, "same-report.json"),
      env: {},
    },
    {
      name: "different report paths",
      staticReport: path.join(root, "static-report.json"),
      behaviorReport: path.join(root, "behavior-report.json"),
      env: {},
    },
    {
      name: "partial mixed-case controls",
      staticReport: path.join(root, "partial-static.json"),
      behaviorReport: path.join(root, "partial-behavior.json"),
      env: {
        Org_Workbench_Packaged_Smoke_Root: root,
        org_workbench_packaged_behavior_smoke_nonce: NONCE,
      },
      partial: true,
    },
  ];

  for (const fixture of fixtures) {
    const env = fixture.partial
      ? fixture.env
      : {
        Org_Workbench_Packaged_Smoke_Root: root,
        org_workbench_packaged_smoke_report: fixture.staticReport,
        ORG_WORKBENCH_PACKAGED_SMOKE_NONCE: NONCE,
        org_workbench_packaged_behavior_smoke_root: root,
        Org_Workbench_Packaged_Behavior_Smoke_Report: fixture.behaviorReport,
        ORG_WORKBENCH_PACKAGED_BEHAVIOR_SMOKE_NONCE: "b".repeat(64),
      };
    const requests = reservePackagedSmokeRequests(env, {
      isPackaged: true,
      nativePlatform: "win32",
      tempRoot: os.tmpdir(),
    });
    assert.equal(requests.conflict, true, fixture.name);
    assert.equal(requests.smokeRequest, null, fixture.name);
    assert.equal(requests.behaviorSmokeRequest, null, fixture.name);
    assert.equal(fs.existsSync(fixture.staticReport), false, `${fixture.name} created static inode`);
    assert.equal(fs.existsSync(fixture.behaviorReport), false, `${fixture.name} created behavior inode`);
  }
});

test("Windows-case control lookup activates one complete family without leaking another", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = path.join(root, "mixed-case-static.json");
  const requests = reservePackagedSmokeRequests({
    Org_Workbench_Packaged_Smoke_Root: root,
    org_workbench_packaged_smoke_report: report,
    ORG_WORKBENCH_PACKAGED_SMOKE_NONCE: NONCE,
  }, {
    isPackaged: true,
    nativePlatform: "win32",
    tempRoot: os.tmpdir(),
  });
  assert.equal(requests.conflict, false);
  assert.notEqual(requests.smokeRequest, null);
  assert.equal(requests.behaviorSmokeRequest, null);
  closeSmokeReportReservation(requests.smokeRequest);
});

async function behaviorVm(overrides) {
  const storage = new Map();
  const timers = new Map();
  let nextTimer = 1;
  const window = {
    owb: {
      status: async () => ({
        running: true,
        health: {
          status: "ok",
          engine: { available: true },
          hosts: { qoder: { ready: true } },
        },
      }),
      workspace: async () => ({ status: 200, body: { open: true } }),
      createSession: async () => ({
        status: 201,
        body: { sessionId: "12345678-1234-4123-8123-123456789abc" },
      }),
      createSessionTurn: async () => ({
        status: 200,
        body: {
          turnId: "turn-fixture",
          status: "completed",
          output: "packaged path smoke ok",
        },
      }),
      sessionTurnHistory: async () => ({
        status: 200,
        body: {
          turns: [{
            turnId: "turn-fixture",
            status: "completed",
            output: "packaged path smoke ok",
          }],
        },
      }),
      ...overrides,
    },
  };
  const result = vm.runInNewContext(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, {
    document: {
      querySelector: () => ({ childElementCount: 1 }),
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    },
    window,
    setTimeout: (callback) => {
      const timer = nextTimer;
      nextTimer += 1;
      timers.set(timer, callback);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
  });
  // Let every already-resolved production IPC promise progress. The one timer
  // still registered after this turn belongs to the intentionally hung stage.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  return result;
}

test("production behavior renderer timeouts write nonce-bound failure reports and quit", async (t) => {
  const never = () => new Promise(() => {});
  const fixtures = [
    ["control plane status", { status: never }],
    ["workspace read", { workspace: never }],
    ["session create", { createSession: never }],
    ["Qoder session fixture turn", { createSessionTurn: never }],
    ["session history readback", { sessionTurnHistory: never }],
  ];
  for (const [stage, overrides] of fixtures) {
    await t.test(stage, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
      t.after(() => fs.rmSync(root, { force: true, recursive: true }));
      const request = packagedBehaviorSmokeRequest(behaviorEnv(
        root,
        path.join(root, "behavior-timeout.json"),
      ));
      assert.notEqual(request, null);
      let quitCount = 0;
      let reportWrittenCount = 0;
      await runPackagedBehaviorSmoke({
        reportRequest: request,
        webContents: {
          executeJavaScript: (script) => {
            assert.equal(script, PACKAGED_BEHAVIOR_SMOKE_SCRIPT);
            return behaviorVm(overrides);
          },
        },
        serverPid: 42,
        resourcesPath: "/fixture/resources",
        onReportWritten: () => { reportWrittenCount += 1; },
        quit: () => { quitCount += 1; },
      });
      const report = JSON.parse(fs.readFileSync(request.report, "utf8"));
      assert.equal(report.ok, false);
      assert.equal(report.nonce, NONCE);
      assert.match(report.error, new RegExp(`${stage} timed out`));
      assert.equal(request.reportFd, null);
      assert.equal(reportWrittenCount, 1);
      assert.equal(quitCount, 1);
    });
  }
});

test("behavior qualification traverses durable session turn history", () => {
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.createSession\(/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.createSessionTurn\(/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.sessionTurnHistory\(/);
});

test("behavior qualification is business-facing but separate from static smoke", () => {
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.status\(\)/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.createSession/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.createSessionTurn/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.sessionTurnHistory/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /const withTimeout/);
  for (const stage of [
    "control plane status",
    "workspace read",
    "session create",
    "Qoder session fixture turn",
    "session history readback",
  ]) {
    assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, new RegExp(stage));
  }
  assert.doesNotMatch(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /orgWorkbenchPackagedSmoke/);

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(mainSource, /static and behavior packaged smoke modes are mutually exclusive/);
  assert.match(mainSource, /reservePackagedSmokeRequests/);
  assert.equal(
    mainSource.match(/startPackagedSmokeLifecycle\(/g)?.length,
    2,
    "static and behavior modes must use the same production lifecycle gate",
  );
});

test("both smoke reports carry the fields the external oracle probes", async (t) => {
  // The harness probes the control plane over HTTP in either mode, so a field the
  // static report carries and the behavior report omits is not a cosmetic mismatch:
  // it makes the probe build `http://127.0.0.1:undefined/health` and fail the run.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owb-clean-staging-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const staticPath = path.join(root, "smoke-report.json");
  const staticRequest = packagedSmokeRequest({
    ORG_WORKBENCH_PACKAGED_SMOKE_NONCE: NONCE,
    ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: staticPath,
    ORG_WORKBENCH_PACKAGED_SMOKE_ROOT: root,
  });
  assert.notEqual(staticRequest, null);
  await runPackagedSmoke({
    reportRequest: staticRequest,
    webContents: { executeJavaScript: async () => ({ rendererMounted: true, preloadBridge: true }) },
    appPid: process.pid,
    serverPid: 4242,
    serverPort: 51515,
    resourcesPath: root,
    close: () => {},
  });

  const behaviorPath = path.join(root, "behavior-report.json");
  const behaviorRequest = packagedBehaviorSmokeRequest(behaviorEnv(root, behaviorPath));
  assert.notEqual(behaviorRequest, null);
  await runPackagedBehaviorSmoke({
    reportRequest: behaviorRequest,
    webContents: { executeJavaScript: async () => ({ qoderReady: true }) },
    serverPid: 4242,
    serverPort: 51515,
    resourcesPath: root,
    quit: () => {},
  });

  for (const [label, file] of [["static", staticPath], ["behavior", behaviorPath]]) {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const field of ["serverPid", "serverPort"]) {
      assert.equal(
        Number.isInteger(report[field]),
        true,
        `${label} report is missing ${field}, which the control plane probe requires`,
      );
    }
  }
});
