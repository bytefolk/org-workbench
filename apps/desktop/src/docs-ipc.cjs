// Document routing IPC validators (#35 S2/S4, DS-35-001 rev-1 §3/§5/§6).
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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDocsCreateRequest(request) {
  if (!isPlainObject(request)) return invalidResponse("request must be an object");
  const keys = Object.keys(request).sort().join(",");
  if (keys !== "content,path,positionId") {
    return invalidResponse("request must carry exactly {positionId, path, content}");
  }
  if (
    typeof request.positionId !== "string" ||
    request.positionId.length === 0 ||
    typeof request.path !== "string" ||
    request.path.length === 0 ||
    typeof request.content !== "string"
  ) {
    return invalidResponse("positionId, path and content must be strings");
  }
  return {
    ok: true,
    request: { positionId: request.positionId, path: request.path, content: request.content },
  };
}

function validateDocsResolveRequest(request) {
  if (!isPlainObject(request)) return invalidResponse("request must be an object");
  if (Object.keys(request).sort().join(",") !== "ref") {
    return invalidResponse("request must carry exactly {ref}");
  }
  const ref = request.ref;
  if (!isPlainObject(ref) || typeof ref.uri !== "string" || ref.uri.length === 0) {
    return invalidResponse("ref must carry a uri string");
  }
  const allowed = ["uri", "anchor", "version"];
  if (Object.keys(ref).some((key) => !allowed.includes(key))) {
    return invalidResponse("ref must carry at most {uri, anchor?, version?}");
  }
  return { ok: true, request: { ref } };
}

module.exports = {
  validateDocsListRequest,
  validateDocsReadRequest,
  validateDocsCreateRequest,
  validateDocsResolveRequest,
};
