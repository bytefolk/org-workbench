// IPC boundary gate for POST /hire (#33). Mirrors the server-side first gate
// at reduced depth: shape only, fail-closed. The control plane remains the
// authoritative validator for hire-request.v1alpha1 inputs.
const { isPositionId } = require("@org-workbench/shared/position-id");

const MODES = new Set(["read_only", "approval_required"]);
const NETWORK_POLICIES = new Set(["deny", "host_policy"]);
const REQUESTED_MODES = new Set(["read", "write"]);
const KNOWN_KEYS = new Set(["positionId", "name", "description", "reportTo", "mode", "budget", "deadline", "network", "mcp"]);
const MCP_KEYS = new Set(["tools", "servers"]);

function invalid(message) {
  return { status: 400, body: { code: "hire_request_invalid", message, retryable: false } };
}

function validateHireRequest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: invalid("hire request must be an object") };
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) {
      return { ok: false, response: invalid(`unknown field: ${key}`) };
    }
  }
  if (!isPositionId(value.positionId)) {
    return { ok: false, response: invalid("positionId is invalid") };
  }
  for (const key of ["name", "description"]) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) {
      return { ok: false, response: invalid(`${key} must be a non-empty string`) };
    }
  }
  if (value.reportTo !== null && !isPositionId(value.reportTo)) {
    return { ok: false, response: invalid("reportTo must be a position id or null") };
  }
  if (!MODES.has(value.mode)) {
    return { ok: false, response: invalid("mode must be read_only or approval_required") };
  }
  if (value.budget === null || typeof value.budget !== "object" || Array.isArray(value.budget)) {
    return { ok: false, response: invalid("budget is required") };
  }
  if (value.deadline !== undefined && typeof value.deadline !== "string") {
    return { ok: false, response: invalid("deadline must be a string") };
  }
  if (value.network !== undefined && !NETWORK_POLICIES.has(value.network)) {
    return { ok: false, response: invalid("network must be deny or host_policy") };
  }
  if (value.mcp !== undefined) {
    const rejection = validateMcpGrant(value.mcp, value.mode);
    if (rejection) return { ok: false, response: rejection };
  }
  return { ok: true, request: value };
}

// #89 shape-only mirror: tools and servers must arrive together and non-empty,
// and a read_only employee may not request a write-mode tool. The control
// plane stays the authoritative validator for transport details.
function validateMcpGrant(mcp, mode) {
  if (mcp === null || typeof mcp !== "object" || Array.isArray(mcp)) {
    return invalid("mcp must be an object");
  }
  for (const key of Object.keys(mcp)) {
    if (!MCP_KEYS.has(key)) return invalid(`unknown field: mcp.${key}`);
  }
  if (!Array.isArray(mcp.tools) || mcp.tools.length === 0) {
    return invalid("mcp.tools must be a non-empty array");
  }
  if (!Array.isArray(mcp.servers) || mcp.servers.length === 0) {
    return invalid("mcp.servers must be a non-empty array");
  }
  for (const tool of mcp.tools) {
    if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
      return invalid("mcp.tools entries must be objects");
    }
    if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
      return invalid("mcp.tools entries need a non-empty name");
    }
    if (!REQUESTED_MODES.has(tool.requestedMode)) {
      return invalid("mcp.tools requestedMode must be read or write");
    }
    if (mode === "read_only" && tool.requestedMode === "write") {
      return invalid("a read_only employee cannot request a write-mode mcp tool");
    }
  }
  for (const server of mcp.servers) {
    if (server === null || typeof server !== "object" || Array.isArray(server)) {
      return invalid("mcp.servers entries must be objects");
    }
    if (typeof server.name !== "string" || server.name.trim().length === 0) {
      return invalid("mcp.servers entries need a non-empty name");
    }
    const transport = server.transport;
    if (transport === null || typeof transport !== "object" || Array.isArray(transport)) {
      return invalid("mcp.servers entries need a transport object");
    }
    if (transport.type === "stdio") {
      if (typeof transport.command !== "string" || transport.command.trim().length === 0) {
        return invalid("stdio transport needs a non-empty command");
      }
    } else if (transport.type === "http") {
      if (typeof transport.url !== "string" || !transport.url.startsWith("https://")) {
        return invalid("http transport needs an https url");
      }
    } else {
      return invalid("mcp transport type must be stdio or http");
    }
  }
  return null;
}

module.exports = { validateHireRequest };
