/**
 * Change manifest contract (change-manifest.v1) — the shape POST /org/apply accepts.
 *
 * Semantics follow #157 R3 as amended by #33: move = re-report, delete =
 * disband, reorder = same-parent sibling ordering. The former `add` op (hire)
 * is removed — employee creation flows exclusively through POST /hire and the
 * hire-request.v1alpha1 governance envelope (digital-employee #194/#198); a
 * manifest carrying `add` is rejected as an unknown op. Validation of
 * structural lawfulness lives in digital-employee `org apply` — the client
 * only enforces the manifest shape and never pre-judges the outcome.
 */

export const CHANGE_MANIFEST_SCHEMA_VERSION = "change-manifest.v1" as const;

export interface MovePositionChange {
  op: "move";
  id: string;
  /** null moves the position directly under positions/. */
  reportTo: string | null;
}

export interface DeletePositionChange {
  op: "delete";
  id: string;
}

/**
 * Additive reorder op (#32, D-32-2): same-parent sibling ordering only.
 * The control plane validates set identity against the parent's current
 * children and writes the org-layout.v1 overlay; the op never reaches the
 * engine (ordering is not an engine contract surface).
 */
export interface ReorderPositionsChange {
  op: "reorder";
  /** Parent whose children are reordered; null = top level. */
  parentId: string | null;
  /** Complete ordered id list of that parent's children. */
  order: string[];
}

export type OrgChange =
  | MovePositionChange
  | DeletePositionChange
  | ReorderPositionsChange;

export interface ChangeManifest {
  schemaVersion: typeof CHANGE_MANIFEST_SCHEMA_VERSION;
  /** Applied in order to the positions/ proposal tree; engine validation is authoritative. */
  changes: OrgChange[];
}

/** Success result of an atomic publish. */
export interface OrgApplySuccess {
  status: "applied";
  version: { seq: number; updatedAt: string };
  changesApplied: number;
}

/** Failure result; `code` is server-native or an engine passthrough. */
export interface OrgApplyFailure {
  status: "failed";
  code: string;
  message: string;
  retryable: boolean;
}

export type OrgApplyResult = OrgApplySuccess | OrgApplyFailure;

export interface OrgBackupEntry {
  backupId: string;
  positionId: string;
  dismissedAt: string;
  reportTo: string | null;
  name: string;
}

export interface OrgBackupsResponse {
  schemaVersion: "org-backups.v1";
  backups: OrgBackupEntry[];
}

export interface OrgRestoreRequest {
  backupId: string;
}

export interface OrgRestoreSuccess {
  status: "applied";
  backupId: string;
  positionId: string;
  /** false means a repeated request found the same position already applied. */
  restored: boolean;
  version: { seq: number; updatedAt: string };
}

export type OrgRestoreResult = OrgRestoreSuccess | OrgApplyFailure;

export interface EngineOrgApplySuccess {
  status: "applied";
  business: string;
  owner: string;
  bootstrapped: boolean;
  positions: number;
  changes: {
    hired: string[];
    moved: Array<{ id: string; from: string | null; to: string | null }>;
    dismissed: string[];
    budgetUpdated: string[];
  };
  organization: string;
  audit: string;
  permissions: string;
}

/** Driver contract for `digital-employee org apply <workspace> --json`. */
export interface OrgApplyDriver {
  apply(workspaceDir: string): Promise<
    | { status: "applied"; result?: EngineOrgApplySuccess }
    | { status: "failed"; code: string; message: string; retryable: boolean }
    | { status: "engine_unavailable"; message: string }
    | { status: "engine_capability_missing"; message: string }
  >;
}
