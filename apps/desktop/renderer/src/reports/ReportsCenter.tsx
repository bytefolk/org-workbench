import { useState } from "react";
import { BudgetBar } from "@org-workbench/ui";
import type { AuditEntry, BudgetReport, EvidenceEntry, EscalationEntry, ReportsResponse } from "@org-workbench/shared";
import { Activity, AlertOctagon, ClipboardList, Fingerprint } from "lucide-react";

type Tab = "escalations" | "audits" | "evidence";

export function ReportsCenter({ reports, loading }: { reports: ReportsResponse | null; loading: boolean }) {
  const [tab, setTab] = useState<Tab>("escalations");
  if (loading) return <section className="owb-reports"><p className="owb-muted">正在读取本地上报事实…</p></section>;
  if (!reports) return <section className="owb-reports"><p className="owb-muted">上报数据不可用</p></section>;
  return (
    <section className="owb-reports" aria-label="上报中心">
      <header className="owb-reports__hero">
        <div><span>LOCAL CONTROL PLANE</span><h1>上报中心</h1><p>只读展示审计、回合证据与失败升级；原始输入和输出默认不进入此视图。</p></div>
        <Activity aria-hidden="true" size={28} />
      </header>
      <BudgetDeck budgets={reports.budgets} />
      <nav className="owb-report-tabs" aria-label="上报数据流">
        <TabButton active={tab === "escalations"} onClick={() => setTab("escalations")} label="失败 / 升级" count={reports.streams.escalations.length} />
        <TabButton active={tab === "audits"} onClick={() => setTab("audits")} label="组织审计" count={reports.streams.audits.length} />
        <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")} label="回合证据" count={reports.streams.evidence.length} />
      </nav>
      <div className="owb-report-stream">
        {tab === "escalations" ? <Escalations entries={reports.streams.escalations} /> : null}
        {tab === "audits" ? <Audits entries={reports.streams.audits} /> : null}
        {tab === "evidence" ? <Evidence entries={reports.streams.evidence} /> : null}
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
