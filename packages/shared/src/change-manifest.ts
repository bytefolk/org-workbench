/**
 * Change manifest contract (change-manifest.v1) — the shape POST /org/apply accepts.
 *
 * Semantics follow #157 R3: add = hire (MUST carry a budget declaration,
 * REQ-006), move = re-report, delete = disband. Validation of budget fullness
 * and structural lawfulness lives in digital-employee `org apply` — the client
 * only enforces the manifest shape and never pre-judges the outcome.
 */

import type { PositionBudget, PositionMode } from "./org-tree.js";

export const CHANGE_MANIFEST_SCHEMA_VERSION = "change-manifest.v1" as const;

export const POSITION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export interface AddPositionChange {
  op: "add";
  position: {
    id: string;
    name: string;
    description: string;
    reportTo: string | null;
    mode: PositionMode;
    memoryScope: string;
    toolAllow: string[];
    toolDeny: string[];
    /** REQ-006: hire without budget is a manifest-level rejection. */
    budget: PositionBudget;
    metadata?: Record<string, string>;
  };
}

export interface MovePositionChange {
  op: "move";
  id: string;
  reportTo: string;
}

export interface DeletePositionChange {
  op: "delete";
  id: string;
}

export type OrgChange = AddPositionChange | MovePositionChange | DeletePositionChange;

export interface ChangeManifest {
  schemaVersion: typeof CHANGE_MANIFEST_SCHEMA_VERSION;
  /** Applied in order against a staging copy; engine validation is authoritative. */
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
  /** Where the rejected staging copy is preserved for audit. */
  rejectedStaging: string;
}

export type OrgApplyResult = OrgApplySuccess | OrgApplyFailure;

/** Driver contract for the engine-side apply step (spawn, pinned version). */
export interface OrgApplyDriver {
  apply(stagingDir: string): Promise<
    | { status: "applied" }
    | { status: "failed"; code: string; message: string; retryable: boolean }
    | { status: "engine_unavailable"; message: string }
    | { status: "engine_capability_missing"; message: string }
  >;
}
