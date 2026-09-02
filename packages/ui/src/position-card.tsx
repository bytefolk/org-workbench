import type { ReactNode } from "react";
import { Button, Empty, Skeleton } from "antd";
import { cn } from "@fullstack-ai-infra/ui";
import { ChartNoAxesColumn, Cloud, Crosshair, FileText, Info, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { BudgetBar } from "./budget-bar";
import type { PositionCardData } from "./types";
import type { ContextSourceSummary } from "@org-workbench/shared";

export interface PositionCardProps {
  position: PositionCardData | null;
  loading?: boolean;
  notFound?: boolean;
  onRefresh?: () => void;
  /** Per-task consumption ratio (0..1+) for the budget gauge; null/undefined
   * keeps the gauge in declaration phase — never a fabricated percentage. */
  consumption?: number | null;
  /** Live turn in flight for this position: header status light breathes. */
  running?: boolean;
  /** #137 review: operator actions (e.g. the dismiss dialog) render inside
   * the card header's right cluster instead of floating outside the card. */
  actions?: ReactNode;
  className?: string;
}

/**
 * PositionCard — read-only position record (#73 signature move ②「岗位即端点」).
 *
 * Rendered as the custom `.owb-panel` shell from
 * docs/design/control-plane-v2-preview.html, not an antd Card: eyebrow
 * (POSITION · DEVICE RECORD) + display-font title + role sub-line, a mode
 * badge and a status light on the right, then three sections — budget gauge
 * (dual lane), permission chips, context sources. antd still supplies the
 * controls (Button/Empty/Skeleton) per DL5.
 *
 * States: empty guidance / loading skeleton / 404 after disband / record.
 */
export function PositionCard({
  position,
  loading = false,
  notFound = false,
  onRefresh,
  consumption = null,
  running = false,
  actions,
  className,
}: PositionCardProps) {
  if (loading) {
    return (
      <section className={cn("owb-panel", "ui-org-position-card", className)} aria-label="岗位档案">
        <header className="owb-panel-head">
          <div className="owb-panel-head__main">
            <div className="owb-panel-head__eyebrow">POSITION · DEVICE RECORD</div>
            <div className="ui-org-position-card__skeleton-title">
              <Skeleton.Input active block size="small" />
            </div>
          </div>
        </header>
        <div className="owb-pos-body">
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        </div>
      </section>
    );
  }

  if (notFound) {
    return (
      <section
        className={cn("owb-panel", "ui-org-position-card", "ui-org-position-card--notice", className)}
        aria-label="岗位档案"
      >
        <header className="owb-panel-head">
          <div className="owb-panel-head__main">
            <div className="owb-panel-head__eyebrow">POSITION · DEVICE RECORD</div>
            <h2>岗位不可用</h2>
          </div>
          <div className="owb-panel-head__right">
            <span className="owb-badge owb-badge--muted">已裁撤</span>
          </div>
        </header>
        <div className="owb-panel__notice">
          <Info aria-hidden="true" size={26} className="ui-org-position-card__notice-icon" />
          <p>岗位已不存在（可能已裁撤）；目录保留在 backup，可从恢复区显式恢复。</p>
          {onRefresh ? (
            <Button type="primary" icon={<RefreshCw aria-hidden="true" size={13} />} onClick={onRefresh}>
              刷新组织树
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (!position) {
    return (
      <section
        className={cn("owb-panel", "ui-org-position-card", "ui-org-position-card--empty", className)}
        aria-label="岗位档案"
      >
        <header className="owb-panel-head">
          <div className="owb-panel-head__main">
            <div className="owb-panel-head__eyebrow">POSITION · DEVICE RECORD</div>
            <h2>岗位档案</h2>
          </div>
        </header>
        <div className="owb-panel__notice">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择岗位查看档案" />
        </div>
      </section>
    );
  }

  const readOnly = position.mode === "read_only";
  const contextSources = position.contextSources ?? legacyContextSource(position);
  return (
    <section className={cn("owb-panel", "ui-org-position-card", className)} aria-label="岗位档案">
      <header className="owb-panel-head">
        <div className="owb-panel-head__main">
          <div className="owb-panel-head__eyebrow">POSITION · DEVICE RECORD</div>
          <h2>{position.name}</h2>
          <p className="owb-panel-head__sub">
            {position.id}
            {position.reportTo ? ` — 汇报给 ${position.reportTo}` : " — 企业负责人"}
          </p>
        </div>
        <div className="owb-panel-head__right">
          {actions}
          <span className={cn("owb-badge", readOnly ? "owb-badge--read" : "owb-badge--approval")}>
            <Zap aria-hidden="true" size={11} />
            {readOnly ? "只读" : "需批准"}
          </span>
          <span
            className={cn("owb-led", running && "owb-led--running")}
            role="img"
            aria-label={running ? "回合运行中" : "岗位就绪"}
            title={running ? "回合运行中" : "岗位就绪"}
          />
        </div>
      </header>

      <div className="owb-pos-body">
        <p className="owb-pos-desc">{position.description}</p>

        <section className="owb-pos-section">
          <h3>
            <ChartNoAxesColumn aria-hidden="true" size={13} />
            预算声明
          </h3>
          <BudgetBar
            declared={
              position.budget
                ? { taskLimit: position.budget.perTask, dailyLimit: position.budget.perDay }
                : null
            }
            consumption={consumption}
          />
        </section>

        <section className="owb-pos-section">
          <h3>
            <ShieldCheck aria-hidden="true" size={13} />
            权限摘要
          </h3>
          <div className="owb-tagrow">
            {position.permissions.toolAllow.length === 0 ? (
              <span className="owb-tag owb-tag--muted">无允许工具</span>
            ) : (
              position.permissions.toolAllow.map((tool) => (
                <span key={tool} className="owb-tag">
                  {tool}
                </span>
              ))
            )}
            {position.permissions.toolDeny.map((tool) => (
              <span key={tool} className="owb-tag owb-tag--deny">
                deny {tool}
              </span>
            ))}
          </div>
        </section>

        <section className="owb-pos-section">
          <h3>
            <Crosshair aria-hidden="true" size={13} />
            上下文来源
          </h3>
          <div className="owb-context-sources">
            {contextSources.map((source) => (
              <ContextSourceRow key={source.id} source={source} />
            ))}
          </div>
          <p className="owb-context-sources__hint">
            左侧目录树只配置汇报关系；来源由 Workbench 统一绑定，mem/context 继续负责各自的数据与召回。
          </p>
        </section>
      </div>
    </section>
  );
}

function legacyContextSource(position: PositionCardData): ContextSourceSummary[] {
  return [{
    id: "legacy-context-scope",
    kind: "workspace_docs",
    name: "岗位上下文",
    locator: position.contextScope || "未声明",
    binding: "bound",
    state: position.contextScope ? "ready" : "empty",
    readOnly: true,
  }];
}

function ContextSourceRow({ source }: { source: ContextSourceSummary }) {
  const SourceIcon = source.kind === "workspace_docs"
    ? FileText
    : source.kind === "mem_drive"
      ? Cloud
      : Crosshair;
  const stateLabel = {
    ready: source.kind === "workspace_docs" ? "已接入" : "已配置",
    empty: "暂无内容",
    not_configured: "未配置",
    error: "读取失败",
  }[source.state];
  const bindingLabel = source.binding === "bound" ? "当前绑定" : "可接入";
  const countLabel = source.itemCount === undefined
    ? ""
    : ` · ${source.itemCount} ${source.kind === "workspace_docs" ? "份文档" : "条记录"}`;
  return (
    <div className="owb-context-source">
      <div className="owb-context-source__head">
        <span className="owb-context-source__icon" aria-hidden="true"><SourceIcon size={13} /></span>
        <div className="owb-context-source__main">
          <strong>{source.name}</strong>
          <span title={source.locator}>{source.locator}</span>
        </div>
        <span className={`owb-context-source__state is-${source.state}`}>{stateLabel}</span>
      </div>
      <div className="owb-context-source__meta">{bindingLabel}{countLabel}{source.readOnly ? " · 只读" : ""}</div>
    </div>
  );
}
