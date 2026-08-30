import { Button, Drawer, Statistic } from "antd";
import { BudgetBar } from "@org-workbench/ui";
import type { BudgetReport } from "@org-workbench/shared";
import { ArrowUpRight } from "lucide-react";

export interface BudgetDetailDrawerProps {
  open: boolean;
  budget: (BudgetReport & { displayName?: string; ratio?: number | null }) | null;
  onClose: () => void;
  onOpenTimeline?: (positionId: string) => void;
}

/** Right-side drawer with the full BudgetBar (per-task + per-day lanes) and the
 * raw evidence panels. Honest-lane rule: per-day never renders a percentage —
 * only the declared cap and「未记录」. */
export function BudgetDetailDrawer({ open, budget, onClose, onOpenTimeline }: BudgetDetailDrawerProps) {
  const title = budget
    ? `${budget.displayName ?? budget.positionId} · 预算详情`
    : "预算详情";
  const ratio = budget?.ratio
    ?? (budget && budget.latestTurn && budget.declared.perTask.tokens
      ? budget.latestTurn.totalTokens / budget.declared.perTask.tokens
      : null);
  return (
    <Drawer
      className="owb-budget-drawer"
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      destroyOnClose
      aria-label="预算详情抽屉"
    >
      {budget ? (
        <div className="owb-budget-drawer__body">
          <section aria-label="声明与事实">
            <BudgetBar
              declared={{
                taskLimit: budget.declared.perTask,
                dailyLimit: budget.declared.perDay,
              }}
              consumption={ratio}
              format="full"
              label="预算声明 × 事实"
            />
          </section>
          <section aria-label="最近回合 usage" className="owb-budget-drawer__usage">
            <h4>最近回合 usage</h4>
            {budget.latestTurn ? (
              <div className="owb-budget-drawer__stats">
                <Statistic title="input" value={budget.latestTurn.inputTokens} />
                <Statistic title="output" value={budget.latestTurn.outputTokens} />
                <Statistic title="total" value={budget.latestTurn.totalTokens} />
              </div>
            ) : (
              <p className="owb-muted">尚未记录任何回合（声明期）</p>
            )}
          </section>
          <section aria-label="累计记录" className="owb-budget-drawer__usage">
            <h4>累计记录</h4>
            <div className="owb-budget-drawer__stats">
              <Statistic title="input" value={budget.recorded.inputTokens} />
              <Statistic title="output" value={budget.recorded.outputTokens} />
              <Statistic title="total" value={budget.recorded.totalTokens} />
            </div>
            <p className="owb-muted">口径：全部已记录回合累计（非「今日」）</p>
          </section>
          {onOpenTimeline ? (
            <div className="owb-budget-drawer__actions">
              <Button
                type="primary"
                onClick={() => {
                  onOpenTimeline(budget.positionId);
                  onClose();
                }}
                icon={<ArrowUpRight size={14} />}
              >
                查看时间线
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
