import fs from "node:fs/promises";
import path from "node:path";
import { OrgApiError, errorCodes } from "@org-workbench/shared";
import type {
  AuditEntry,
  BudgetReport,
  EvidenceEntry,
  EscalationEntry,
  OrgRole,
  ReportUsage,
  ReportsResponse,
  TurnRecord,
} from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { sendJson } from "../http.js";
import { RUNTIME_DIR } from "../org/apply.js";
import type { ServerResponse } from "node:http";

export async function handleReports(
  ctx: ControlPlaneContext,
  res: ServerResponse,
): Promise<void> {
  const ws = ctx.workspace.requireOpen();
  const audits = await readOrgAudit(path.join(ws.dir, RUNTIME_DIR, "org-audit.jsonl"));
  let records: TurnRecord[];
  try {
    records = await ctx.turnStore.reportRecords(ws.dir);
  } catch {
    throw invalidReports();
  }
  const evidence = records.map(toEvidence);
  const escalations = records.flatMap((record) => toEscalation(record, ws.organization.roles));
  const body: ReportsResponse = {
    schemaVersion: "reports.v1",
    streams: {
      escalations,
      audits,
      evidence,
    },
    budgets: buildBudgets(ws.organization.roles, records),
    page: { cursor: null, hasMore: false },
  };
  sendJson(res, 200, body);
}

async function readOrgAudit(file: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw invalidReports();
  }
  if (Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) throw invalidReports();
  const entries: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isAuditEntry(parsed)) throw invalidReports();
      entries.push(parsed);
    } catch {
      throw invalidReports();
    }
  }
  return entries.slice(-200).reverse();
}

function invalidReports(): OrgApiError {
  return new OrgApiError(errorCodes.reports_data_invalid, 500, "local reports data is invalid");
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<AuditEntry>;
  const changes = entry.changes as Partial<AuditEntry["changes"]> | undefined;
  return entry.schemaVersion === "org-audit.v1" &&
    typeof entry.at === "string" &&
    typeof entry.actor === "string" &&
    typeof entry.workspace === "string" &&
    typeof entry.bootstrapped === "boolean" &&
    Number.isSafeInteger(entry.positionCount) &&
    changes !== undefined &&
    Array.isArray(changes.hired) &&
    Array.isArray(changes.moved) &&
    Array.isArray(changes.dismissed) &&
    Array.isArray(changes.budgetUpdated);
}

function usageOf(record: TurnRecord): ReportUsage {
  const usage: ReportUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const event of record.events) {
    if (event.type !== "usage") continue;
    usage.inputTokens += event.inputTokens ?? 0;
    usage.outputTokens += event.outputTokens ?? 0;
    usage.totalTokens += event.totalTokens ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0));
  }
  return usage;
}

function toEvidence(record: TurnRecord): EvidenceEntry {
  return {
    schemaVersion: "turn-evidence.v1",
    positionId: record.positionId,
    turnId: record.turnId,
    conversationId: record.conversationId,
    engine: record.engine,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    envelopeDigest: record.envelopeDigest,
    ...(record.runId ? { runId: record.runId } : {}),
    usage: usageOf(record),
    ...(record.error?.code ? { errorCode: record.error.code } : {}),
  };
}

function toEscalation(record: TurnRecord, roles: OrgRole[]): EscalationEntry[] {
  if (record.status !== "failed" && record.status !== "indeterminate") return [];
  const code = record.error?.code ?? (record.status === "indeterminate" ? "turn_indeterminate" : "turn_failed");
  return [{
    schemaVersion: "turn-escalation.v1",
    positionId: record.positionId,
    turnId: record.turnId,
    at: record.updatedAt,
    status: record.status,
    code,
    reportingChain: reportingChain(record.positionId, roles),
    budgetRelated: code === "turn_budget_exceeded" || code === "position_budget_exceeded",
  }];
}

function reportingChain(positionId: string, roles: OrgRole[]): string[] {
  const parents = new Map(roles.map((role) => [role.id, role.reportTo]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = positionId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain;
}

function buildBudgets(roles: OrgRole[], records: TurnRecord[]): BudgetReport[] {
  return roles.map((role) => {
    const own = records.filter((record) => record.positionId === role.id);
    const recorded = own.reduce<ReportUsage>((total, record) => {
      const usage = usageOf(record);
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.totalTokens += usage.totalTokens;
      return total;
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const latestTurn = own[0] ? usageOf(own[0]) : null;
    const overByUsage = latestTurn !== null &&
      role.budget.perTask.tokens !== undefined &&
      latestTurn.totalTokens > role.budget.perTask.tokens;
    const overByTerminal = own.some((record) =>
      record.error?.code === "turn_budget_exceeded" || record.error?.code === "position_budget_exceeded");
    return {
      positionId: role.id,
      declared: role.budget,
      recorded,
      latestTurn,
      state: own.length === 0 ? "unobserved" : overByUsage || overByTerminal ? "exceeded" : "within",
    };
  });
}
