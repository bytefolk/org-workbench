const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PACKAGED_BEHAVIOR_SMOKE_SCRIPT,
  packagedBehaviorSmokeRequest,
} = require("../src/packaged-behavior-smoke.cjs");
const { closeSmokeReportReservation } = require("../src/packaged-smoke.cjs");

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

test("behavior qualification is business-facing but separate from static smoke", () => {
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.status\(\)/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.createTurn/);
  assert.match(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /window\.owb\.turnHistory/);
  assert.doesNotMatch(PACKAGED_BEHAVIOR_SMOKE_SCRIPT, /orgWorkbenchPackagedSmoke/);

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(mainSource, /static and behavior packaged smoke modes are mutually exclusive/);
  assert.match(mainSource, /closeSmokeReportReservation\(behaviorSmokeRequest\)/);
});
