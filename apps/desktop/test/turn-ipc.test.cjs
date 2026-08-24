const assert = require("node:assert/strict");
const test = require("node:test");
const { turnHistoryPath, validateCreateTurnRequest } = require("../src/turn-ipc.cjs");

test("turn IPC accepts only the two contracted Hosts and exact request fields", () => {
  assert.deepEqual(validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "ship the release",
    engine: "qoder",
  }), {
    ok: true,
    request: { positionId: "repo-owner", input: "ship the release", engine: "qoder" },
  });
  assert.equal(validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "ship",
    engine: "claude-code",
  }).ok, true);
  assert.equal(validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "ship",
    engine: "openai",
  }).ok, false);
  assert.equal(validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "ship",
    engine: "qoder",
    token: "must-never-cross-the-bridge",
  }).ok, false);
});

test("turn history IPC constructs only a bounded position query", () => {
  assert.equal(turnHistoryPath("repo-owner"), "/turns?positionId=repo-owner");
  assert.equal(turnHistoryPath("../../secret"), null);
  assert.equal(turnHistoryPath(""), null);
});
