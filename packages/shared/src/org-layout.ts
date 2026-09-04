/**
 * org-layout.v1 — the org-workbench-autonomous layout overlay (#32, D-32-1).
 *
 * org-tree.v1 is a frozen minimal shape with no sibling-order semantics. This
 * overlay persists explicit same-parent ordering without touching the engine
 * contract or org-tree.v1: `order` keys are the parent position id (or
 * ORG_LAYOUT_ROOT_KEY for top-level positions), values are ordered child id
 * arrays. Missing entries fall back to alphabetical order (zero migration for
 * pre-#32 workspaces).
 */

import type { OrgApplyFailure } from "./change-manifest.js";

export const ORG_LAYOUT_SCHEMA_VERSION = "org-layout.v1" as const;

/** Overlay key used for the top level (reportTo === null). */
export const ORG_LAYOUT_ROOT_KEY = "_root" as const;

export interface OrgLayoutFile {
  schemaVersion: typeof ORG_LAYOUT_SCHEMA_VERSION;
  updatedAt: string;
  order: Record<string, string[]>;
}

/** Success body of POST /org/undo (single-step undo, #32 AC-005). */
export interface OrgUndoSuccess {
  status: "undone";
  version: { seq: number; updatedAt: string };
}

export type OrgUndoResult = OrgUndoSuccess | OrgApplyFailure;
