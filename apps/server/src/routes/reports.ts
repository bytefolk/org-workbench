import fs from "node:fs/promises";
import path from "node:path";
import type { AuditEntry, ReportsResponse } from "@org-workbench/shared";
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
  const body: ReportsResponse = {
    schemaVersion: "reports.v1",
    streams: {
      escalations: [],
      audits,
      evidence: [],
    },
    page: { cursor: null, hasMore: false },
  };
  sendJson(res, 200, body);
}

async function readOrgAudit(file: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const entries: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<AuditEntry>;
      if (parsed.schemaVersion === "org-audit.v1") entries.push(parsed as AuditEntry);
    } catch {
      continue;
    }
  }
  return entries.slice(-200).reverse();
}
