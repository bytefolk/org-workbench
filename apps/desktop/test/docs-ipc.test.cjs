const assert = require("node:assert/strict");
const test = require("node:test");
const { validateDocsListRequest, validateDocsReadRequest } = require("../src/docs-ipc.cjs");

test("docs list IPC bounds the position id and encodes the contract route (#35 S2)", () => {
  const ok = validateDocsListRequest("repo-owner");
  assert.equal(ok.ok, true);
  assert.equal(ok.pathname, "/docs/list?position=repo-owner");

  for (const bad of ["", 42, null, undefined, { positionId: "repo-owner" }]) {
    const invalid = validateDocsListRequest(bad);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.response.body.code, "docs_request_invalid");
  }
});

test("docs read IPC forwards both arguments encoded and refuses empty input (#35 S2)", () => {
  const ok = validateDocsReadRequest("repo-owner", "knowledge/README.md");
  assert.equal(ok.ok, true);
  assert.equal(ok.pathname, "/docs/read?position=repo-owner&path=knowledge%2FREADME.md");

  const missingPath = validateDocsReadRequest("repo-owner", "");
  assert.equal(missingPath.ok, false);
  assert.equal(missingPath.response.body.message, "filePath required");

  const missingPosition = validateDocsReadRequest("", "SKILL.md");
  assert.equal(missingPosition.ok, false);
  assert.equal(missingPosition.response.body.message, "positionId required");

  // Traversal attempts pass through only encoded — the server guards decide.
  const traversal = validateDocsReadRequest("repo-owner", "../../workspace.json");
  assert.equal(traversal.ok, true);
  assert.equal(
    traversal.pathname,
    "/docs/read?position=repo-owner&path=..%2F..%2Fworkspace.json",
  );
});
