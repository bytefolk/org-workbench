/**
 * Hire channel contract (#33, consuming digital-employee #194/#198).
 *
 * Creating an employee flows exclusively through the hire-request.v1alpha1
 * thin reference envelope validated by `digital-employee hire validate`
 * (static, fail-closed). The change-manifest `add` op was removed in the
 * same revision: POST /org/apply no longer accepts employee creation, so no
 * direct-write bypass of the hire governance gate exists (AC-001).
 *
 * Field-level alignment with configs/hire-request.schema.json at b3d54bf:
 * the control plane owns targetParentId resolution against the org tree and
 * identity display fields; the envelope vocabulary itself is never extended.
 */

import type { PositionBudget, PositionMode } from "./org-tree.js";

export const HIRE_REQUEST_SCHEMA_VERSION = "hire-request.v1alpha1" as const;

/** Employee tool/MCP data-plane egress policy (employee-package.schema.json `policy.network`). */
export type NetworkPolicy = "deny" | "host_policy";

export const EMPLOYEE_MCP_SCHEMA_VERSION = "employee-mcp.v1alpha1" as const;

/**
 * #89 MCP grant vocabulary. Mirrors two upstream contracts that the control
 * plane must satisfy together: `policy.mcpTools` in
 * employee-package.schema.json (the tool allowlist) and employee-mcp.v1alpha1
 * (packages/core/src/employee-mcp.ts — the server connections written to
 * `entrypoints.mcp`). Upstream keeps the two namespaces independent: a tool
 * name is never matched against a server name.
 */
export type McpRequestedMode = "read" | "write";

export interface McpToolRequest {
  name: string;
  requestedMode: McpRequestedMode;
}

export type McpServerTransport =
  | {
      type: "stdio";
      command: string;
      /** Upstream defaults both list fields to empty when omitted. */
      args?: string[];
      /** Environment variable NAMES passed through; never values. */
      environment?: string[];
    }
  | {
      type: "http";
      /** HTTPS only upstream; no credentials or fragment in the URL. */
      url: string;
      /** Header values are sourced from named environment variables, never inlined. */
      headers?: Array<{ name: string; valueFromEnv: string }>;
    };

export interface McpServerRequest {
  name: string;
  transport: McpServerTransport;
}

/**
 * Atomic grant: upstream rejects a package whose `policy.mcpTools` is
 * non-empty without an `entrypoints.mcp` file, so the control plane accepts
 * tools and servers together or not at all.
 */
export interface HireMcpGrant {
  tools: McpToolRequest[];
  servers: McpServerRequest[];
}

/** employee-mcp.v1alpha1 file the control plane writes as `entrypoints.mcp`. */
export interface EmployeeMcpManifest {
  schemaVersion: typeof EMPLOYEE_MCP_SCHEMA_VERSION;
  servers: McpServerRequest[];
}

/** Shape POST /hire accepts from the renderer (frozen by docs/api-contract-v0.md §2.13). */
export interface HirePositionRequest {
  positionId: string;
  name: string;
  description: string;
  /** Parent position id; null hires directly under the company root. */
  reportTo: string | null;
  mode: PositionMode;
  /** REQ-006 parity: a hire without budget is rejected at every gate. */
  budget: PositionBudget;
  /** Optional ISO 8601 passthrough onto the envelope deadline (upstream-optional). */
  deadline?: string;
  /** #87 v0 additive field; omitted or absent means "deny" (today's behavior). */
  network?: NetworkPolicy;
  /** #89 v0 additive field; omitted means no MCP grant (today's behavior). */
  mcp?: HireMcpGrant;
}

export interface HirePackageReference {
  name: string;
  /** Package format selector; matches upstream `^v1alpha1(\.[0-9]+)?$`. */
  version: string;
  /** Sealed reference digest (upstream minLength 16). */
  digest: string;
}

/** Exact mirror of hire-request.v1alpha1 (configs/hire-request.schema.json). */
export interface HireRequestEnvelope {
  schemaVersion: typeof HIRE_REQUEST_SCHEMA_VERSION;
  workspaceRef: string;
  packageRef: HirePackageReference;
  targetParentId: string;
  budget: PositionBudget;
  requestedBy: string;
  /** Upstream-optional; when present must parse as an ISO 8601 timestamp. */
  deadline?: string;
  envelopeDigest: string;
}

export interface HireSuccess {
  status: "hired";
  positionId: string;
  version: { seq: number; updatedAt: string };
}

export interface HireFailure {
  status: "failed";
  code: string;
  message: string;
  retryable: boolean;
}

export type HireResult = HireSuccess | HireFailure;

/**
 * Driver seam for `digital-employee hire validate <file> --json` (#198).
 * Upstream is static and fail-closed: exit 0 with {status:"valid"}, or
 * exit 1 with {status:"failed", code:"hire_request_*"} before any effect.
 */
export interface HireValidateDriver {
  hireValidate(
    file: string,
  ): Promise<
    | { status: "valid" }
    | { status: "failed"; code: string; message: string }
    | { status: "engine_unavailable"; message: string }
    | { status: "engine_capability_missing"; message: string }
  >;
}
