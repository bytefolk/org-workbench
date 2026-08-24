/** Shapes for GET /health and GET /workspace, GET /reports (frozen at v0). */

import type { TurnEngine } from "./turns.js";

export interface TurnHostHealth {
  /** The required credential variable exists and is non-empty; its value never leaves the server. */
  configured: boolean;
  /** Local preflight only: pinned CLI reachable AND the Host credential is configured. */
  ready: boolean;
  /** Actionable, non-sensitive explanation when the Host cannot accept a turn. */
  nextStep?: string;
}

export interface HealthResponse {
  status: "ok";
  api: "v0";
  server: {
    version: string;
    pid: number;
  };
  engine: {
    /** Command the control plane spawns (pinned digital-employee CLI). */
    command: string;
    available: boolean;
    version?: string;
    /** Actionable next step when unavailable ("failure still has a path"). */
    nextStep?: string;
  };
  /** Per-Host local preflight. This does not claim that a credential was accepted remotely. */
  hosts: Record<TurnEngine, TurnHostHealth>;
  workspace: {
    open: boolean;
    path?: string;
  };
}

export interface WorkspaceInfoResponse {
  open: boolean;
  path?: string;
  business?: string;
  owner?: string;
  version?: { seq: number; updatedAt: string };
}

export interface WorkspaceOpenRequest {
  path: string;
}

import type { OrgRole } from "./org-tree.js";

/** Report-center streams (D2: audits come from engine org-audit.v1). */
export interface ReportsResponse {
  schemaVersion: "reports.v1";
  streams: {
    escalations: unknown[];
    audits: AuditEntry[];
    evidence: unknown[];
  };
  page: { cursor: string | null; hasMore: boolean };
}

export interface AuditEntry {
  schemaVersion: "org-audit.v1";
  at: string;
  actor: string;
  workspace: string;
  bootstrapped: boolean;
  changes: {
    hired: OrgRole[];
    moved: Array<{ id: string; from: string | null; to: string | null }>;
    dismissed: OrgRole[];
    budgetUpdated: string[];
  };
  positionCount: number;
}
