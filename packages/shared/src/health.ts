/** Shapes for GET /health and GET /workspace, GET /reports (frozen at v0). */

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

/** Report-center streams (D0: audits come from the apply log; others empty). */
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
  ts: string;
  kind: "org.applied" | "org.rejected";
  status: string;
  code?: string;
  changes: Array<{ op: string; id: string }>;
}
