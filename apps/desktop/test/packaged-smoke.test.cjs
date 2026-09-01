const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { packagedSmokeReportPath } = require("../src/packaged-smoke.cjs");

test("packaged smoke report is opt-in and confined to the process temp directory", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owb-smoke-path-"));
  const report = path.join(temp, "report.json");
  assert.equal(packagedSmokeReportPath({ ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: report }, temp), report);
  assert.equal(packagedSmokeReportPath({}, temp), null);
  assert.equal(
    packagedSmokeReportPath({ ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: "relative.json" }, temp),
    null,
  );
  assert.equal(
    packagedSmokeReportPath({ ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: path.join(temp, "..", "outside.json") }, temp),
    null,
  );
});

test("packaged smoke report never overwrites an existing file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owb-smoke-existing-"));
  const report = path.join(temp, "report.json");
  fs.writeFileSync(report, "existing\n");
  assert.equal(packagedSmokeReportPath({ ORG_WORKBENCH_PACKAGED_SMOKE_REPORT: report }, temp), null);
});
