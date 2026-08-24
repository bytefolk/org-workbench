import { Button, Card, Empty, Skeleton, Tag } from "antd";
import { cn } from "@fullstack-ai-infra/ui";
import { Info, RefreshCw, ShieldCheck } from "lucide-react";
import { BudgetBar } from "./budget-bar";
import type { PositionCardData } from "./types";

export interface PositionCardProps {
  position: PositionCardData | null;
  loading?: boolean;
  notFound?: boolean;
  onRefresh?: () => void;
  className?: string;
}

/**
 * PositionCard — read-only position card (D1 spec §3), skinned with Ant
 * Design per ADR-0002. Three sections: budget declaration (BudgetBar full +
 * mono caps), permissions summary (ShieldCheck + tags), Context Scope summary.
 * States: empty guidance / loading skeleton / 404 after disband / card.
 */
export function PositionCard({
  position,
  loading = false,
  notFound = false,
  onRefresh,
  className,
}: PositionCardProps) {
  if (loading) {
    return (
      <Card className={cn("ui-org-position-card", className)}>
        <div className="ui-org-position-card__skeleton-title">
          <Skeleton.Input active block size="small" />
        </div>
        <Skeleton active title={false} paragraph={{ rows: 3 }} />
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card className={cn("ui-org-position-card", "ui-org-position-card--notice", className)}>
        <Empty
          image={<Info aria-hidden="true" size={28} className="ui-org-position-card__notice-icon" />}
          description={<p>岗位已不存在（可能已裁撤）</p>}
        >
          {onRefresh ? (
            <Button type="primary" icon={<RefreshCw aria-hidden="true" size={13} />} onClick={onRefresh}>
              刷新组织树
            </Button>
          ) : null}
        </Empty>
      </Card>
    );
  }

  if (!position) {
    return (
      <Card className={cn("ui-org-position-card", "ui-org-position-card--empty", className)}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择岗位查看档案" />
      </Card>
    );
  }

  return (
    <Card
      className={cn("ui-org-position-card", className)}
      title={
        <span className="ui-org-position-card__title">
          {position.name}
          <Tag className="ui-org-position-card__mode">
            {position.mode === "read_only" ? "只读" : "需批准"}
          </Tag>
        </span>
      }
    >
      <p className="ui-org-position-card__description">{position.description}</p>
      <section className="ui-org-position-card__section">
        <h3>预算声明</h3>
        <BudgetBar
          declared={
            position.budget
              ? { taskLimit: position.budget.perTask, dailyLimit: position.budget.perDay }
              : null
          }
        />
      </section>
      <section className="ui-org-position-card__section">
        <h3>
          <ShieldCheck aria-hidden="true" size={14} />
          权限摘要
        </h3>
        <div className="ui-org-position-card__permissions">
          {position.permissions.toolAllow.length === 0 ? (
            <span className="ui-org-position-card__muted">无允许工具</span>
          ) : (
            position.permissions.toolAllow.map((tool) => (
              <Tag key={tool}>{tool}</Tag>
            ))
          )}
          {position.permissions.toolDeny.map((tool) => (
            <Tag key={tool} className="ui-org-position-card__deny">
              {tool}
            </Tag>
          ))}
        </div>
      </section>
      <section className="ui-org-position-card__section">
        <h3>Context Scope</h3>
        <p className="ui-org-position-card__scope" title={position.contextScope}>
          {position.contextScope || "—"}
        </p>
      </section>
    </Card>
  );
}
