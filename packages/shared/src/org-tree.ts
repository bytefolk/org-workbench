/**
 * Organization tree contract mirror.
 *
 * Mirrors digital-employee `apps/cli/workspace/templates.ts` RenderedOrganization
 * (schemaVersion workspace-org.v1, origin/main) plus the budget field approved in
 * #157 R3 (DEC-DE-157-002) and specified by the V1 design
 * (apps/cli/org/budget.ts, configs/workspace-org.schema.json — pending publish).
 *
 * Mirror discipline: when digital-employee publishes the schema or changes the
 * shape, this file follows; the client never invents semantics. Budget units are
 * tokens / iterations only — never currency (#155 non-goal).
 */

export const WORKSPACE_ORG_SCHEMA_VERSION = "workspace-org.v1" as const;
export const WORKSPACE_MANIFEST_SCHEMA_VERSION = "workspace.v1alpha1" as const;
export const ORG_TREE_SCHEMA_VERSION = "org-tree.v1" as const;

/** Budget scope: positive integer caps; each cap <= 1_000_000_000. */
export interface BudgetScope {
  tokens?: number;
  iterations?: number;
}

/**
 * Position budget declaration (REQ-006: hire = budget attached, exactly one per
 * position). "Fully allocated" = perTask AND perDay each carry at least one
 * positive integer cap; checking full allocation is the engine's job
 * (digital-employee org apply), never the client's.
 */
export interface PositionBudget {
  perTask: BudgetScope;
  perDay: BudgetScope;
}

export interface PositionPackageRef {
  name: string;
  version: string;
  digest: string;
  /** Absolute final position path; state-bearing, never printed to logs. */
  localReference: string;
}

export type PositionMode = "read_only" | "approval_required";

export interface OrgRole {
  id: string;
  name: string;
  description: string;
  /** null = root/owner position. */
  reportTo: string | null;
  package: PositionPackageRef;
  mode: PositionMode;
  memoryScope: string;
  toolAllow: string[];
  toolDeny: string[];
  /**
   * Present once the workspace materializes the #157 budget contract. The D0
   * example workspace carries it; the #166-era template output does not yet.
   */
  budget?: PositionBudget;
  metadata: Record<string, string>;
}

export interface OrganizationFile {
  $schema?: string;
  schemaVersion: typeof WORKSPACE_ORG_SCHEMA_VERSION;
  business: string;
  description: string;
  owner: string;
  roles: OrgRole[];
  updatedAt: string;
}

export interface OrgTreeVersion {
  /** Monotonic control-plane stamp; bumped on every org.updated. */
  seq: number;
  updatedAt: string;
}

/** Snapshot served by GET /org/tree. */
export interface OrgTreeSnapshot {
  schemaVersion: typeof ORG_TREE_SCHEMA_VERSION;
  workspacePath: string;
  business: string;
  owner: string;
  /** Reporting edges derived from roles (child -> parent). */
  edges: Array<{ positionId: string; reportTo: string | null }>;
  positions: OrgRole[];
  organization: OrganizationFile;
  version: OrgTreeVersion;
}

export interface WorkspaceManifest {
  $schema?: string;
  schemaVersion: typeof WORKSPACE_MANIFEST_SCHEMA_VERSION;
  name: string;
  description: string;
  template: string;
  createdAt: string;
  organization: string;
  positions: string;
  context: string;
}
