// Single-source fail-closed validation for the #193 pendingApproval verdict
// field, mirroring the digital-employee envelope first gate
// (apps/cli/turn/envelope.ts parseTurnEnvelope pendingApproval checks).
// Both boundaries consume this module: the desktop IPC layer (CommonJS
// directly) and the control-plane HTTP route (via src/pending-approval.ts),
// each wrapping the result into its own turn_request_invalid response shape.
const MAX_APPROVAL_ID_LENGTH = 256;
const MAX_APPROVAL_REASON_BYTES = 1024;

function invalid(message) {
  return { ok: false, message };
}

function validatePendingApproval(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid("pendingApproval must be a JSON object");
  }
  // Required+optional key check; equivalent to the upstream envelope gate's
  // accepted field set, without hand-enumerating every sorted-key shape.
  const required = ["approvalId", "decision", "decidedBy"];
  const optional = ["scope", "reason", "expiresAt"];
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => key in value) ||
      !Object.keys(value).every((key) => allowed.has(key))) {
    return invalid("pendingApproval accepts approvalId, decision, decidedBy plus optional scope, reason, expiresAt");
  }
  if (typeof value.approvalId !== "string" || value.approvalId.trim().length === 0 ||
      value.approvalId.length > MAX_APPROVAL_ID_LENGTH) {
    return invalid("pendingApproval.approvalId is invalid");
  }
  if (value.decision !== "granted" && value.decision !== "denied") {
    return invalid("pendingApproval.decision must be granted or denied");
  }
  if (value.decidedBy !== "operator") {
    return invalid("pendingApproval.decidedBy must be operator");
  }
  if (value.scope !== undefined && value.scope !== "once" && value.scope !== "run") {
    return invalid("pendingApproval.scope must be once or run when present");
  }
  if (value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.trim().length === 0 ||
       Buffer.byteLength(value.reason, "utf8") > MAX_APPROVAL_REASON_BYTES)) {
    return invalid("pendingApproval.reason must be non-empty and no larger than 1024 bytes");
  }
  if (value.expiresAt !== undefined &&
      (typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt)))) {
    return invalid("pendingApproval.expiresAt must be a valid ISO 8601 timestamp");
  }
  return {
    ok: true,
    value: {
      approvalId: value.approvalId,
      decision: value.decision,
      decidedBy: "operator",
      ...(value.scope !== undefined ? { scope: value.scope } : {}),
      ...(value.reason !== undefined ? { reason: value.reason } : {}),
      ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
    },
  };
}

module.exports = {
  MAX_APPROVAL_ID_LENGTH,
  MAX_APPROVAL_REASON_BYTES,
  validatePendingApproval,
};
