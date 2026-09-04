const assert = require("node:assert/strict");
const test = require("node:test");
const { validatePendingApproval } = require("../src/approval-ipc.cjs");
const { validateCreateTurnRequest } = require("../src/turn-ipc.cjs");
const { validateSessionTurnRequest } = require("../src/session-ipc.cjs");

const VERDICT = { approvalId: "appr-1", decision: "granted", decidedBy: "operator", scope: "once" };

test("approval IPC mirrors the upstream #193 first-gate checks fail closed", () => {
  assert.deepEqual(validatePendingApproval(VERDICT), { ok: true, value: VERDICT });
  assert.equal(
    validatePendingApproval({ approvalId: "appr-1", decision: "denied", decidedBy: "operator", reason: "risky" }).ok,
    true,
  );
  for (const bad of [
    null,
    "granted",
    [VERDICT],
    { approvalId: "", decision: "granted", decidedBy: "operator" },
    { approvalId: "a".repeat(257), decision: "granted", decidedBy: "operator" },
    { approvalId: "appr-1", decision: "maybe", decidedBy: "operator" },
    { approvalId: "appr-1", decision: "granted", decidedBy: "model" },
    { approvalId: "appr-1", decision: "granted" },
    { approvalId: "appr-1", decidedBy: "operator" },
    { ...VERDICT, scope: "always" },
    { ...VERDICT, reason: "   " },
    { ...VERDICT, reason: "字".repeat(342) },
    { ...VERDICT, expiresAt: "yesterday" },
    { ...VERDICT, note: "side channel" },
  ]) {
    const result = validatePendingApproval(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(result.response.status, 400);
    assert.equal(result.response.body.code, "turn_request_invalid");
  }
});

test("createTurn IPC forwards a validated pendingApproval and rejects violations before the bridge", () => {
  const accepted = validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "[verdict] resume",
    engine: "qoder",
    pendingApproval: VERDICT,
  });
  assert.deepEqual(accepted, {
    ok: true,
    request: { positionId: "repo-owner", input: "[verdict] resume", engine: "qoder", pendingApproval: VERDICT },
  });
  const withoutVerdict = validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "hello",
    engine: "qoder",
  });
  assert.deepEqual(withoutVerdict, {
    ok: true,
    request: { positionId: "repo-owner", input: "hello", engine: "qoder" },
  });
  const rejected = validateCreateTurnRequest({
    positionId: "repo-owner",
    input: "[verdict] resume",
    engine: "qoder",
    pendingApproval: { ...VERDICT, decidedBy: "model" },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.response.body.code, "turn_request_invalid");
});

test("session turn IPC applies the same mirrored verdict validation", () => {
  const accepted = validateSessionTurnRequest({
    sessionId: "3f2b6a1e-9c4d-4e8a-8f21-6b7d0c9e5a12",
    input: "[verdict] resume",
    engine: "qoder",
    pendingApproval: VERDICT,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.request, { input: "[verdict] resume", engine: "qoder", pendingApproval: VERDICT });
  const rejected = validateSessionTurnRequest({
    sessionId: "3f2b6a1e-9c4d-4e8a-8f21-6b7d0c9e5a12",
    input: "[verdict] resume",
    engine: "qoder",
    pendingApproval: { ...VERDICT, decision: "maybe" },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.response.body.code, "turn_request_invalid");
});
