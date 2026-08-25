const assert = require("node:assert/strict");
const test = require("node:test");
const {
  sessionListPath,
  sessionPath,
  validateSessionCreateRequest,
  validateSessionTurnRequest,
} = require("../src/session-ipc.cjs");

const sessionId = "11111111-1111-4111-8111-111111111111";

test("session IPC accepts exact typed fields and never accepts authority data", () => {
  assert.deepEqual(validateSessionCreateRequest({ positionId: "repo-owner" }), {
    ok: true,
    request: { positionId: "repo-owner" },
  });
  assert.equal(validateSessionCreateRequest({ positionId: "repo-owner", principal: "admin" }).ok, false);
  assert.deepEqual(validateSessionTurnRequest({ sessionId, input: "ship", engine: "qoder" }), {
    ok: true,
    sessionId,
    request: { input: "ship", engine: "qoder" },
  });
  assert.equal(validateSessionTurnRequest({ sessionId, input: "ship", engine: "claude-local" }).ok, true);
  assert.equal(validateSessionTurnRequest({ sessionId, input: "ship", engine: "openai" }).ok, false);
  assert.equal(validateSessionTurnRequest({ sessionId, input: "ship", engine: "qoder", token: "secret" }).ok, false);
});

test("session IPC constructs only bounded enumerated paths", () => {
  assert.equal(sessionListPath("repo-owner"), "/sessions?positionId=repo-owner");
  assert.equal(sessionListPath("../../secret"), null);
  assert.equal(sessionPath(sessionId), `/sessions/${sessionId}`);
  assert.equal(sessionPath(sessionId, "/rotate"), `/sessions/${sessionId}/rotate`);
  assert.equal(sessionPath("../../secret", "/turns"), null);
});
