// Read-only document routing IPC validators (#35 S2, DS-35-001 rev-1 §5).
// The server side owns the fail-closed path guards; here the whitelist only
// bounds the argument shapes and encodes them into the contract routes.

function invalidResponse(message) {
  return {
    ok: false,
    response: {
      status: 400,
      body: { code: "docs_request_invalid", message, retryable: false },
    },
  };
}

function validateDocsListRequest(positionId) {
  if (typeof positionId !== "string" || positionId.length === 0) {
    return invalidResponse("positionId required");
  }
  return { ok: true, pathname: `/docs/list?position=${encodeURIComponent(positionId)}` };
}

function validateDocsReadRequest(positionId, filePath) {
  if (typeof positionId !== "string" || positionId.length === 0) {
    return invalidResponse("positionId required");
  }
  if (typeof filePath !== "string" || filePath.length === 0) {
    return invalidResponse("filePath required");
  }
  return {
    ok: true,
    pathname: `/docs/read?position=${encodeURIComponent(positionId)}&path=${encodeURIComponent(filePath)}`,
  };
}

module.exports = { validateDocsListRequest, validateDocsReadRequest };
