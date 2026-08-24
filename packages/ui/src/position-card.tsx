import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@fullstack-ai-infra/ui";
import { Info, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@fullstack-ai-infra/ui";
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
 * PositionCard — read-only position card (D1 spec §3).
 * Three sections: budget declaration (BudgetBar full + mono caps),
 * permissions summary (ShieldCheck + badges), Context Scope summary.
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
        <CardHeader>
          <Skeleton className="ui-org-position-card__skeleton-title" />
        </CardHeader>
        <CardContent>
          <Skeleton className="ui-org-position-card__skeleton-line" />
          <Skeleton className="ui-org-position-card__skeleton-line" />
          <Skeleton className="ui-org-position-card__skeleton-line" style={{ width: "60%" }} />
        </CardContent>
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card className={cn("ui-org-position-card", "ui-org-position-card--notice", className)}>
        <CardContent>
          <Info aria-hidden="true" size={16} />
          <p>岗位已不存在（可能已裁撤）</p>
          {onRefresh ? (
            <button type="button" className="ui-org-position-card__refresh" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" size={13} />
              刷新组织树
            </button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (!position) {
    return (
      <Card className={cn("ui-org-position-card", "ui-org-position-card--empty", className)}>
        <CardContent>
          <p>从左侧选择岗位查看档案</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("ui-org-position-card", className)}>
      <CardHeader>
        <CardTitle>
          {position.name}
          <Badge tone="neutral" className="ui-org-position-card__mode">
            {position.mode === "read_only" ? "只读" : "需批准"}
          </Badge>
        </CardTitle>
        <p className="ui-org-position-card__description">{position.description}</p>
      </CardHeader>
      <CardContent>
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
                <Badge key={tool} tone="neutral">
                  {tool}
                </Badge>
              ))
            )}
            {position.permissions.toolDeny.map((tool) => (
              <Badge key={tool} tone="neutral" className="ui-org-position-card__deny">
                {tool}
              </Badge>
            ))}
          </div>
        </section>
        <section className="ui-org-position-card__section">
          <h3>Context Scope</h3>
          <p className="ui-org-position-card__scope" title={position.contextScope}>
            {position.contextScope || "—"}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
