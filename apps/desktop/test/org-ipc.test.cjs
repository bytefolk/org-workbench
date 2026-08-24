const assert = require("node:assert/strict");
const test = require("node:test");
const { validateRestoreRequest } = require("../src/org-ipc.cjs");

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
