/**
 * Context source summaries surfaced by the workbench position record.
 *
 * This is an additive view contract, not a second memory implementation:
 * the workbench owns source binding and display, while mem owns drive data and
 * context owns scoped recall/derivation.
 */

export const CONTEXT_SOURCE_SUMMARY_SCHEMA_VERSION = "context-source-summary.v1" as const;

export type ContextSourceKind = "workspace_docs" | "mem_drive" | "context_provider";
export type ContextSourceBinding = "bound" | "available";
export type ContextSourceState = "ready" | "empty" | "not_configured" | "error";

export interface ContextSourceSummary {
  id: string;
  kind: ContextSourceKind;
  name: string;
  /** Stable, user-safe locator. Never an absolute local path or secret. */
  locator: string;
  binding: ContextSourceBinding;
  state: ContextSourceState;
  readOnly: boolean;
  /** Count is omitted when the upstream plane owns the count or is unavailable. */
  itemCount?: number;
}
