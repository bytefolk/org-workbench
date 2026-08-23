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
