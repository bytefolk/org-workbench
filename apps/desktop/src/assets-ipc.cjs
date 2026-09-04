// Asset-layer IPC validators (#36 S1, DS-36-001 rev-1 §5).
// The server side owns the exactKeys validation; here the whitelist only
// bounds the argument shapes and encodes them into the contract routes.

function invalidResponse(message) {
  return {
    ok: false,
    response: {
      status: 400,
      body: { code: "asset_request_invalid", message, retryable: false },
    },
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAssetsListRequest() {
  return { ok: true, pathname: "/assets/list" };
}

function validateAssetsReadRequest(assetId) {
  if (
    typeof assetId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)
  ) {
    return invalidResponse("assetId must be a lowercase uuid");
  }
  return { ok: true, pathname: `/assets/read?asset=${encodeURIComponent(assetId)}` };
}

function validateAssetsCreateRequest(request) {
  if (!isPlainObject(request)) return invalidResponse("request must be an object");
  const keys = Object.keys(request).sort().join(",");
  if (keys !== "kind,sourceRef,title" && keys !== "kind,title") {
    return invalidResponse("request must carry exactly {kind, title, sourceRef?}");
  }
  if (request.kind !== "conversation-excerpt" && request.kind !== "decision") {
    return invalidResponse("kind outside the create allowlist");
  }
  if (typeof request.title !== "string" || request.title.length === 0 || request.title.length > 256) {
    return invalidResponse("title must be a non-empty string of at most 256 characters");
  }
  if (request.sourceRef !== undefined) {
    if (!isPlainObject(request.sourceRef)) return invalidResponse("sourceRef must be an object");
    const sourceKeys = Object.keys(request.sourceRef);
    if (sourceKeys.length === 0) {
      return invalidResponse("sourceRef must carry at least one provenance field or be omitted");
    }
    if (sourceKeys.some((key) => !["sessionId", "positionId", "conversationRef"].includes(key))) {
      return invalidResponse("sourceRef has unexpected keys");
    }
    for (const key of sourceKeys) {
      const value = request.sourceRef[key];
      if (typeof value !== "string" || value.length === 0 || value.length > 512) {
        return invalidResponse(`sourceRef.${key} must be a bounded non-empty string`);
      }
    }
  }
  const payload = { kind: request.kind, title: request.title };
  if (request.sourceRef !== undefined) payload.sourceRef = request.sourceRef;
  return { ok: true, request: payload };
}

module.exports = {
  validateAssetsListRequest,
  validateAssetsReadRequest,
  validateAssetsCreateRequest,
};
