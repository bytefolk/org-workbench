/**
 * Stable error model (frozen at v0).
 *
 * Error body on the wire: { "code": "<stable-code>", "message": "...",
 * "retryable": bool }. Engine-side stable codes (workspace_org_budget_* etc.)
 * are passed through verbatim from `digital-employee org apply` and are NOT
 * redefined here — the registry below only lists codes the control plane
 * itself originates.
 */

export const errorCodes = {
  /** Missing/invalid bearer token (401). */
  unauthorized: "unauthorized",
  /** Request body failed to parse or violates the 1 MiB limit (400). */
  body_invalid: "body_invalid",
  /** Directory lacks the workspace skeleton (workspace.json + organization + positions/). */
  workspace_invalid: "workspace_invalid",
  /** An endpoint needs an open workspace but none is open. */
  workspace_not_open: "workspace_not_open",
  /** Change manifest violates change-manifest.v1 shape. */
  manifest_invalid: "manifest_invalid",
  /** A requested organization backup cannot be restored safely. */
  restore_invalid: "restore_invalid",
  /** A restore target conflicts with an active/proposed position. */
  restore_conflict: "restore_conflict",
  /** Organization file failed structural checks (contract violation upstream). */
  organization_invalid: "organization_invalid",
  /** The pinned digital-employee CLI is not reachable (spawn ENOENT / timeout). */
  engine_unavailable: "engine_unavailable",
  /** The CLI exists but lacks the required subcommand (e.g. org apply pre-V2). */
  engine_capability_missing: "engine_capability_missing",
  /** The engine ran and reported failure; engine code passed through in `cause`. */
  engine_failed: "engine_failed",
  /** A position id referenced by the route does not exist. */
  position_missing: "position_missing",
  /** POST /turns shape or input is invalid. */
  turn_request_invalid: "turn_request_invalid",
  /** The selected Host is outside the D3 qoder/claude-code/claude-local allowlist. */
  turn_engine_unsupported: "turn_engine_unsupported",
  /** The position id is malformed and cannot be used as local state path. */
  turn_position_invalid: "turn_position_invalid",
  /** Local conversation state could not be read or atomically persisted. */
  turn_storage_failed: "turn_storage_failed",
  /** POST/GET /sessions request shape or session id is invalid. */
  session_request_invalid: "session_request_invalid",
  /** A requested session does not exist in the open workspace. */
  session_missing: "session_missing",
  /** Session lifecycle or active-turn state rejects the requested mutation. */
  session_conflict: "session_conflict",
  /** Workspace-local session state failed validation or atomic persistence. */
  session_storage_failed: "session_storage_failed",
  /** A local reports source is malformed or crosses a safe path boundary. */
  reports_data_invalid: "reports_data_invalid",
  /** POST /hire request shape violates the frozen hire channel contract (#33). */
  hire_request_invalid: "hire_request_invalid",
  /** POST /groups request shape violates the S2 group-chat contract (#52). */
  group_request_invalid: "group_request_invalid",
  /** A requested group conversationRef does not exist in the open workspace (#52). */
  group_missing: "group_missing",
  /** Group lifecycle state rejects the requested mutation (#52). */
  group_conflict: "group_conflict",
  /** Workspace-local group state failed validation or atomic persistence (#52). */
  group_storage_failed: "group_storage_failed",
  /** Route not found. */
  not_found: "not_found",
  /** Method not allowed on a known route. */
  method_not_allowed: "method_not_allowed",
  /** Unexpected server fault. */
  internal: "internal",
} as const;

export type ServerErrorCode = (typeof errorCodes)[keyof typeof errorCodes];

export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export class OrgApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, status: number, message: string, retryable = false) {
    super(message);
    this.name = "OrgApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}
