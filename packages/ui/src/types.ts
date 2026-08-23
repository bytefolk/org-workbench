/** Org-workbench UI types. Field semantics mirror digital-employee contracts
 * (#157 R3, workspace-org.v1); the client never invents semantics. */

export type { OrgRole, OrgTreeSnapshot } from "@org-workbench/shared";

export interface BudgetCaps {
  tokens?: number;
  iterations?: number;
}

/** Shape of GET /positions/:id → position-card.v1.position. */
export interface PositionCardData {
  id: string;
  name: string;
  description: string;
  reportTo: string | null;
  mode: "read_only" | "approval_required";
  contextScope: string;
  permissions: { toolAllow: string[]; toolDeny: string[] };
  budget: { perTask: BudgetCaps; perDay: BudgetCaps } | null;
  metadata: Record<string, string>;
}

/** D1 display state of a tree node (consumption-driven states land with D3/D4). */
export type TreeNodeState = "ok" | "warning" | "over" | "readonly" | "ai";

export function primaryCap(caps: BudgetCaps | null | undefined): number | null {
  if (!caps) return null;
  return caps.tokens ?? caps.iterations ?? null;
}

export function capsText(caps: BudgetCaps | null | undefined): string {
  const tokens = caps?.tokens;
  const iterations = caps?.iterations;
  if (tokens !== undefined && iterations !== undefined) return `${tokens.toLocaleString()} tok · ${iterations} iter`;
  if (tokens !== undefined) return `${tokens.toLocaleString()} tokens`;
  if (iterations !== undefined) return `${iterations.toLocaleString()} iter`;
  return "—";
}
