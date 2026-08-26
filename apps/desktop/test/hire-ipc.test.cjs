const assert = require("node:assert/strict");
const test = require("node:test");
const { validateHireRequest } = require("../src/hire-ipc.cjs");

const VALID = {
  positionId: "docs-writer",
  name: "文档负责人",
  description: "维护公开文档与发布说明",
  reportTo: "repo-owner",
  mode: "approval_required",
  budget: { perTask: { tokens: 20000 }, perDay: { tokens: 200000 } },
};

test("hire IPC accepts the contracted HirePositionRequest shape", () => {
  assert.deepEqual(validateHireRequest(VALID), { ok: true, request: VALID });
  assert.equal(validateHireRequest({ ...VALID, reportTo: null }).ok, true);
  assert.equal(validateHireRequest({ ...VALID, deadline: "2026-08-27T00:00:00.000Z" }).ok, true);
});

test("hire IPC fails closed on unknown fields and malformed inputs", () => {
  const cases = [
    null,
    [VALID],
    { ...VALID, token: "must-never-cross-the-bridge" },
    { ...VALID, positionId: "Docs-Writer" },
    { ...VALID, positionId: "a--b" },
    { ...VALID, positionId: "" },
    { ...VALID, name: "" },
    { ...VALID, name: "   " },
    { ...VALID, description: "" },
    { ...VALID, reportTo: "../secret" },
    { ...VALID, mode: "autonomous" },
    { ...VALID, budget: null },
    { ...VALID, deadline: 1756000000000 },
  ];
  for (const candidate of cases) {
    const result = validateHireRequest(candidate);
    assert.equal(result.ok, false, JSON.stringify(candidate));
    assert.equal(result.response.status, 400);
    assert.equal(result.response.body.code, "hire_request_invalid");
    assert.equal(result.response.body.retryable, false);
  }
});
