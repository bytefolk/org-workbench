import { useMemo, useState } from "react";
import { BudgetBar } from "@org-workbench/ui";
import type { AuditEntry, BudgetReport, EvidenceEntry, EscalationEntry, ReportsResponse } from "@org-workbench/shared";
import { Activity, AlertOctagon, ClipboardList, Fingerprint } from "lucide-react";
import { BudgetDashboard } from "./BudgetDashboard";
import { AuditTimeline, type AuditTimelineEvent } from "./AuditTimeline";

type Tab = "budgets" | "escalations" | "audits" | "evidence" | "timeline";

export interface ReportsCenterProps {
  reports: ReportsResponse | null;
  loading: boolean;
  positionNames?: Record<string, string>;
  positionColors?: Record<string, string>;
  onOpenTimeline?: (positionId: string) => void;
}

export function ReportsCenter({ reports, loading, positionNames, positionColors, onOpenTimeline }: ReportsCenterProps) {
  const [tab, setTab] = useState<Tab>("escalations");
  const timelineEvents = useMemo<AuditTimelineEvent[]>(
    () => (reports ? buildTimelineEventsFromReports(reports) : []),
    [reports],
  );
  if (loading) return <section className="owb-reports"><p className="owb-muted">正在读取本地上报事实…</p></section>;
  if (!reports) return <section className="owb-reports"><p className="owb-muted">上报数据不可用</p></section>;
  return (
    <section className="owb-reports" aria-label="上报中心">
      <header className="owb-reports__hero">
        <div><span>LOCAL CONTROL PLANE</span><h1>上报中心</h1><p>只读展示审计、回合证据、失败升级与预算/成本看板；原始输入和输出默认不进入此视图。</p></div>
        <Activity aria-hidden="true" size={28} />
      </header>
      <BudgetDeck budgets={reports.budgets} />
      <nav className="owb-report-tabs" aria-label="上报数据流">
        <TabButton active={tab === "budgets"} onClick={() => setTab("budgets")} label="成本看板" count={reports.budgets.length} />
        <TabButton active={tab === "escalations"} onClick={() => setTab("escalations")} label="失败 / 升级" count={reports.streams.escalations.length} />
        <TabButton active={tab === "audits"} onClick={() => setTab("audits")} label="组织审计" count={reports.streams.audits.length} />
        <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")} label="回合证据" count={reports.streams.evidence.length} />
        <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")} label="时间线" count={timelineEvents.length} />
      </nav>
      <div className="owb-report-stream">
        {tab === "budgets" ? (
          <BudgetDashboard
            budgets={reports.budgets}
            escalations={reports.streams.escalations}
            positionNames={positionNames}
            positionColors={positionColors}
            onOpenTimeline={onOpenTimeline}
          />
        ) : null}
        {tab === "escalations" ? <Escalations entries={reports.streams.escalations} /> : null}
        {tab === "audits" ? <Audits entries={reports.streams.audits} /> : null}
        {tab === "evidence" ? <Evidence entries={reports.streams.evidence} /> : null}
        {tab === "timeline" ? (
          <AuditTimeline
            events={timelineEvents}
            page={{
              cursor: reports.page.cursor,
              hasMore: reports.page.hasMore,
              total: timelineEvents.length,
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function BudgetDeck({ budgets }: { budgets: BudgetReport[] }) {
  return <div className="owb-budget-deck" aria-label="预算仪表">{budgets.map((budget) => {
    const limit = budget.declared.perTask.tokens;
    const ratio = limit && budget.latestTurn ? budget.latestTurn.totalTokens / limit : null;
    return <article key={budget.positionId} data-state={budget.state}><header><strong>{budget.positionId}</strong><span>{budget.state === "unobserved" ? "无回合事实" : budget.state === "exceeded" ? "已超出声明" : "声明内"}</span></header><BudgetBar declared={{ taskLimit: budget.declared.perTask, dailyLimit: budget.declared.perDay }} consumption={ratio} /><small>累计记录 {budget.recorded.totalTokens.toLocaleString()} tokens</small></article>;
  })}</div>;
}

/**
 * v1 timeline projection: fold `reports.streams` into the unified timeline event shape.
 * The full three-source merge (TurnRecord.events / SSE live / org-audit.v1) lands in
 * the data plane; this projection keeps the UI honest to the fields we already carry.
 */
function buildTimelineEventsFromReports(reports: ReportsResponse): AuditTimelineEvent[] {
  const events: AuditTimelineEvent[] = [];
  const evidenceByRun = new Map<string, EvidenceEntry>();
  const evidenceByTurn = new Map<string, EvidenceEntry>();
  for (const evidence of reports.streams.evidence) {
    if (evidence.runId) evidenceByRun.set(evidence.runId, evidence);
    evidenceByTurn.set(evidence.turnId, evidence);
  }
  for (const evidence of reports.streams.evidence) {
    const runId = evidence.runId ?? evidence.turnId;
    events.push({
      id: `evidence:started:${evidence.turnId}`,
      at: evidence.createdAt,
      runId,
      positionId: evidence.positionId,
      engine: evidence.engine,
      type: "run.started",
      task: undefined,
    });
    const terminalType: AuditTimelineEvent["type"] =
      evidence.status === "completed"
        ? "run.completed"
        : evidence.status === "failed"
          ? "run.failed"
          : evidence.status === "indeterminate"
            ? "turn.indeterminate"
            : "run.started";
    events.push({
      id: `evidence:terminal:${evidence.turnId}`,
      at: evidence.updatedAt,
      runId,
      positionId: evidence.positionId,
      engine: evidence.engine,
      type: terminalType,
      errorCode: evidence.errorCode,
      envelopeDigest: evidence.envelopeDigest,
      totalTokens: evidence.usage.totalTokens,
      summary: `${evidence.status} · ${evidence.usage.totalTokens.toLocaleString()} tokens`,
    });
  }
  for (const escalation of reports.streams.escalations) {
    const runId = escalation.turnId;
    events.push({
      id: `escalation:${escalation.turnId}:${escalation.at}`,
      at: escalation.at,
      runId,
      positionId: escalation.positionId,
      type: "escalation.created",
      errorCode: escalation.code,
      budgetRelated: escalation.budgetRelated,
      reportingChain: escalation.reportingChain,
      summary: `${escalation.status} · ${escalation.code}`,
    });
  }
  reports.streams.audits.forEach((audit, index) => {
    events.push({
      id: `audit:${audit.at}:${index}`,
      at: audit.at,
      runId: `audit-${audit.at}-${index}`,
      type: "org.audit",
      summary: `${audit.actor} · 招聘 ${audit.changes.hired.length} · 调岗 ${audit.changes.moved.length} · 裁撤 ${audit.changes.dismissed.length} · 预算 ${audit.changes.budgetUpdated.length} · 应用后 ${audit.positionCount} 岗位`,
    });
  });
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events;
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return <button type="button" aria-pressed={active} onClick={onClick}>{label}<span>{count}</span></button>;
}

function Empty({ text }: { text: string }) { return <p className="owb-report-empty">{text}</p>; }

function Escalations({ entries }: { entries: EscalationEntry[] }) {
  if (entries.length === 0) return <Empty text="没有已记录的失败或不确定回合" />;
  return <ol>{entries.map((entry) => {
    const summary = `${entry.positionId} · ${entry.status}${entry.budgetRelated ? " · 预算相关" : ""}`;
    return <li className="owb-report-card is-escalation" key={entry.turnId}><AlertOctagon aria-hidden="true" size={16} /><div><header><strong>{entry.code}</strong><time>{formatTime(entry.at)}</time></header><p className="owb-clamp-2" title={summary}>{summary}</p><div className="owb-report-chain">{entry.reportingChain.map((position, index) => <span key={position} style={{ borderLeftWidth: Math.min(index + 1, 4) }}>{position}</span>)}</div></div></li>;
  })}</ol>;
}

function Audits({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <Empty text="尚无组织变更审计" />;
  return <ol>{entries.map((entry, index) => {
    const summary = `招聘 ${entry.changes.hired.length} · 调岗 ${entry.changes.moved.length} · 裁撤 ${entry.changes.dismissed.length} · 预算 ${entry.changes.budgetUpdated.length}`;
    return <li className="owb-report-card" key={`${entry.at}-${index}`}><ClipboardList aria-hidden="true" size={16} /><div><header><strong>{entry.actor}</strong><time>{formatTime(entry.at)}</time></header><p className="owb-clamp-2" title={summary}>{summary}</p><small>应用后 {entry.positionCount} 个岗位</small></div></li>;
  })}</ol>;
}

function Evidence({ entries }: { entries: EvidenceEntry[] }) {
  if (entries.length === 0) return <Empty text="尚无可追溯回合证据" />;
  return <ol>{entries.map((entry) => {
    const summary = `${entry.status} · ${entry.usage.totalTokens.toLocaleString()} tokens${entry.errorCode ? ` · ${entry.errorCode}` : ""}`;
    return <li className="owb-report-card" key={entry.turnId}><Fingerprint aria-hidden="true" size={16} /><div><header><strong>{entry.positionId} · {entry.engine}</strong><time>{formatTime(entry.updatedAt)}</time></header><p className="owb-clamp-2" title={summary}>{summary}</p><code className="owb-clamp-2" title={entry.envelopeDigest}>{entry.envelopeDigest}</code><small>turn {entry.turnId} · conversation {entry.conversationId}</small></div></li>;
  })}</ol>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
// Note: History icon reserved for future timeline-tab-only iconography if needed.
void History;
