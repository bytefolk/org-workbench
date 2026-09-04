const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateAssetsCreateRequest,
  validateAssetsListRequest,
  validateAssetsReadRequest,
} = require("../src/assets-ipc.cjs");

test("assets list IPC targets the contract route with no arguments (#36 S1)", () => {
  const ok = validateAssetsListRequest();
  assert.equal(ok.ok, true);
  assert.equal(ok.pathname, "/assets/list");
});

test("assets read IPC bounds the assetId to a lowercase uuid (#36 S1)", () => {
  const ok = validateAssetsReadRequest("0e0f1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b");
  assert.equal(ok.ok, true);
  assert.equal(ok.pathname, "/assets/read?asset=0e0f1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b");

  for (const bad of [
    "",
    42,
    null,
    undefined,
    { assetId: "0e0f1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b" },
    "0E0F1A2B-3C4D-5E6F-8A9B-0C1D2E3F4A5B",
    "../escape",
    "not-a-uuid",
    "0e0f1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b/../../record.json",
  ]) {
    const invalid = validateAssetsReadRequest(bad);
    assert.equal(invalid.ok, false, `must refuse ${JSON.stringify(bad)}`);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.response.body.code, "asset_request_invalid");
  }
});

test("assets create IPC bounds the exactKeys create shape and the allowlist (#36 S1)", () => {
  const ok = validateAssetsCreateRequest({
    kind: "conversation-excerpt",
    title: "Standup excerpt",
    sourceRef: { sessionId: "sess-1", positionId: "repo-owner" },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.request, {
    kind: "conversation-excerpt",
    title: "Standup excerpt",
    sourceRef: { sessionId: "sess-1", positionId: "repo-owner" },
  });

  const minimal = validateAssetsCreateRequest({ kind: "decision", title: "Ship S1" });
  assert.equal(minimal.ok, true);
  assert.deepEqual(minimal.request, { kind: "decision", title: "Ship S1" });

  for (const bad of [
    null,
    "decision",
    [],
    { kind: "decision" },
    { kind: "decision", title: "x", evil: true },
    { kind: "doc", title: "doc lands via document creation" },
    { kind: "ghost", title: "x" },
    { kind: "decision", title: "" },
    { kind: "decision", title: "x".repeat(257) },
    { kind: "decision", title: 42 },
    { kind: "decision", title: "x", sourceRef: {} },
    { kind: "decision", title: "x", sourceRef: "sess-1" },
    { kind: "decision", title: "x", sourceRef: { unexpected: "y" } },
    { kind: "decision", title: "x", sourceRef: { sessionId: "" } },
    { kind: "decision", title: "x", sourceRef: { sessionId: "y".repeat(513) } },
    { kind: "decision", title: "x", sourceRef: { sessionId: 42 } },
  ]) {
    const invalid = validateAssetsCreateRequest(bad);
    assert.equal(invalid.ok, false, `must refuse ${JSON.stringify(bad)}`);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.response.body.code, "asset_request_invalid");
  }
});
