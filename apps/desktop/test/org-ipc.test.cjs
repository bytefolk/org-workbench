const assert = require("node:assert/strict");
const test = require("node:test");
const { validateRestoreRequest, validateOrgApply } = require("../src/org-ipc.cjs");

test("restore IPC forwards only the bounded backup identifier", () => {
  assert.deepEqual(validateRestoreRequest("community-operator-1700000000000-a1b2c3"), {
    ok: true,
    request: { backupId: "community-operator-1700000000000-a1b2c3" },
  });
  assert.equal(validateRestoreRequest("").ok, false);
  assert.equal(validateRestoreRequest("../../employee.json").ok, false);
  assert.equal(validateRestoreRequest("repo-owner-1700000000000-A1B2C3").ok, false);
  assert.equal(validateRestoreRequest("repo-owner-1700000000000-a1b2c3/extra").ok, false);
  assert.equal(validateRestoreRequest({ backupId: "repo-owner-1700000000000-a1b2c3" }).ok, false);
});

const VALID_SCHEMA_VERSION = "change-manifest.v1";
const validManifest = () => ({
  schemaVersion: VALID_SCHEMA_VERSION,
  changes: [{ op: "move", id: "staff", reportTo: "lead" }],
});

test("org apply accepts a well-formed manifest", () => {
  const manifest = validManifest();
  const out = validateOrgApply(manifest);
  assert.equal(out.ok, true);
  assert.equal(out.request, manifest); // identity preserved for forwarding
});

test("org apply rejects non-object manifests and bad schemaVersion", () => {
  assert.equal(validateOrgApply(null).ok, false);
  assert.equal(validateOrgApply([]).ok, false);
  assert.equal(validateOrgApply("nope").ok, false);
  assert.equal(validateOrgApply({ schemaVersion: "other", changes: [] }).ok, false);
  assert.equal(validateOrgApply({ schemaVersion: VALID_SCHEMA_VERSION, changes: [] }).ok, false);
  assert.equal(validateOrgApply({ schemaVersion: VALID_SCHEMA_VERSION, changes: "x" }).ok, false);
});

test("org apply validates each move change", () => {
  const m = (change) => validateOrgApply({ schemaVersion: VALID_SCHEMA_VERSION, changes: [change] });
  assert.equal(m({ op: "move", id: "staff", reportTo: null }).ok, true);
  assert.equal(m({ op: "move", id: "../evil", reportTo: null }).ok, false); // traversal
  assert.equal(m({ op: "move", id: "staff/../../x", reportTo: null }).ok, false); // traversal
  assert.equal(m({ op: "move", id: "STAFF", reportTo: null }).ok, false); // uppercase
  assert.equal(m({ op: "move", id: "staff", reportTo: "../lead" }).ok, false); // traversal reportTo
  assert.equal(m({ op: "move" }).ok, false); // missing id
  assert.equal(m({ op: "move", id: "staff", reportTo: 123 }).ok, false); // non-string reportTo
  assert.equal(m({ op: "move", id: "staff", reportTo: "lead" }).ok, true);
});

test("org apply validates delete and reorder changes", () => {
  const m = (change, changes) =>
    validateOrgApply({ schemaVersion: VALID_SCHEMA_VERSION, changes: changes ?? [change] });
  assert.equal(m({ op: "delete", id: "staff" }).ok, true);
  assert.equal(m({ op: "delete", id: "../evil" }).ok, false);
  assert.equal(m({ op: "delete", id: "" }).ok, false);
  assert.equal(m({ op: "reorder", parentId: null, order: ["a", "b"] }).ok, true);
  assert.equal(m({ op: "reorder", parentId: null, order: [] }).ok, false);
  assert.equal(m({ op: "reorder", parentId: null, order: ["../a"] }).ok, false);
  assert.equal(m({ op: "reorder", parentId: null, order: ["a", "a"] }).ok, false); // duplicate
  assert.equal(m({ op: "reorder", parentId: "../x", order: ["a"] }).ok, false);
  assert.equal(m({ op: "bogus", id: "staff" }).ok, false); // unknown op
});

test("org apply rejects an oversized position id", () => {
  const long = Array(66).fill("a").join("");
  const out = validateOrgApply({
    schemaVersion: VALID_SCHEMA_VERSION,
    changes: [{ op: "move", id: long, reportTo: null }],
  });
  assert.equal(out.ok, false);
});
