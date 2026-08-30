import { useMemo, useState } from "react";
import { Alert, Badge, Empty, Input, Segmented, Skeleton, Statistic, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BudgetBar } from "@org-workbench/ui";
import type { BudgetReport, EscalationEntry } from "@org-workbench/shared";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { BudgetDetailDrawer } from "./BudgetDetailDrawer";

/** P0 预算/成本看板：`reports.v1.budgets` 唯一权威读法。
 *
 * 诚实纪律（design spec §4.1 / §0）：
 *   1. 无货币维度：只展示 tokens / iterations。
 *   2. 声明期不伪造百分比：`latestTurn === null` 时消耗条走 declared-only。
 *   3. 单日车道只声明、不推算：`declared.perDay` 直出「未记录 · 上限 …」。
 *   4. 超限即事实：`state === "exceeded"` 永远置顶 + 左 3px 红条 + 汇总 Alert。
 */
export interface BudgetDashboardProps {
  budgets: BudgetReport[];
  escalations?: EscalationEntry[];
  loading?: boolean;
  positionNames?: Record<string, string>;
  positionColors?: Record<string, string>;
  /** Optional deep-link: called with a turnId / positionId when the user clicks
   *  「查看时间线」in the detail drawer. Wired to the ④ timeline in App.tsx; if
   *  omitted the link is hidden (no dead affordances). */
  onOpenTimeline?: (positionId: string) => void;
}

type FilterKey = "all" | "exceeded" | "approaching" | "declared";

interface BudgetRow extends BudgetReport {
  /** Per-task consumption ratio; null in 声明期 (no latestTurn). */
  ratio: number | null;
  approaching: boolean;
  displayName: string;
  color?: string;
}

/** Ordering: exceeded > approaching (>=80%) > within > unobserved. */
function stateOrder(row: BudgetRow): number {
  if (row.state === "exceeded") return 0;
  if (row.approaching) return 1;
  if (row.state === "within") return 2;
  return 3;
}

function computeRatio(budget: BudgetReport): number | null {
  const limit = budget.declared.perTask.tokens;
  if (!limit || !budget.latestTurn) return null;
  return budget.latestTurn.totalTokens / limit;
}

/** Format numbers with tabular-nums; kept side-effect free so tests can import. */
export function budgetPercentText(ratio: number | null): string {
  if (ratio === null) return "声明期";
  return `${Math.round(ratio * 100)}%`;
}

export function stateLabel(state: BudgetReport["state"]): string {
  if (state === "exceeded") return "已超出";
  if (state === "within") return "声明内";
  return "无事实";
}

export function BudgetDashboard({
  budgets,
  escalations = [],
  loading = false,
  positionNames,
  positionColors,
  onOpenTimeline,
}: BudgetDashboardProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [keyword, setKeyword] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows: BudgetRow[] = useMemo(() => {
    return budgets.map((budget) => {
      const ratio = computeRatio(budget);
      return {
        ...budget,
        ratio,
        approaching: ratio !== null && ratio >= 0.8 && ratio <= 1 && budget.state !== "exceeded",
        displayName: positionNames?.[budget.positionId] ?? budget.positionId,
        color: positionColors?.[budget.positionId],
      };
    });
  }, [budgets, positionNames, positionColors]);

  const summary = useMemo(() => {
    let exceeded = 0;
    let approaching = 0;
    let unobserved = 0;
    for (const row of rows) {
      if (row.state === "exceeded") exceeded += 1;
      else if (row.approaching) approaching += 1;
      if (row.state === "unobserved") unobserved += 1;
    }
    return { total: rows.length, exceeded, approaching, unobserved };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (filter === "exceeded" && row.state !== "exceeded") return false;
      if (filter === "approaching" && !row.approaching) return false;
      if (filter === "declared" && row.state !== "unobserved") return false;
      if (kw.length > 0) {
        return row.positionId.toLowerCase().includes(kw)
          || row.displayName.toLowerCase().includes(kw);
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const diff = stateOrder(a) - stateOrder(b);
      if (diff !== 0) return diff;
      // Within the same state, order by ratio desc so heavier consumers surface first.
      const ra = a.ratio ?? -1;
      const rb = b.ratio ?? -1;
      return rb - ra;
    });
  }, [rows, filter, keyword]);

  const budgetRelatedEscalations = useMemo(
    () => escalations.filter((entry) => entry.budgetRelated),
    [escalations],
  );

  const columns: ColumnsType<BudgetRow> = useMemo(
    () => [
      {
        title: "岗位",
        dataIndex: "positionId",
        key: "position",
        width: 240,
        render: (_: unknown, row: BudgetRow) => (
          <div className="owb-budget-dash__cell-position">
            <span
              aria-hidden="true"
              className="owb-budget-dash__avatar"
              style={row.color ? { backgroundColor: row.color } : undefined}
            />
            <div>
              <strong>{row.displayName}</strong>
              <code>{row.positionId}</code>
            </div>
          </div>
        ),
      },
      {
        title: "单任务消耗",
        key: "perTask",
        render: (_: unknown, row: BudgetRow) => (
          <BudgetBar
            label="单任务"
            declared={{ taskLimit: row.declared.perTask, dailyLimit: null }}
            consumption={row.ratio}
            format="compact"
          />
        ),
      },
      {
        title: "单日",
        key: "perDay",
        width: 200,
        render: (_: unknown, row: BudgetRow) => {
          const cap = row.declared.perDay.tokens ?? row.declared.perDay.iterations;
          const unit = row.declared.perDay.tokens !== undefined ? "tokens" : "iterations";
          return (
            <span className="owb-budget-dash__daily">
              <BudgetBar
                label="单日"
                declared={{ taskLimit: null, dailyLimit: row.declared.perDay }}
                consumption={null}
                format="compact"
              />
              <span className="owb-budget-dash__daily-cap">
                {typeof cap === "number"
                  ? `未记录 · 上限 ${cap.toLocaleString()} ${unit}`
                  : "未声明"}
              </span>
            </span>
          );
        },
      },
      {
        title: "累计记录",
        key: "recorded",
        width: 140,
        align: "right" as const,
        render: (_: unknown, row: BudgetRow) => (
          <Tooltip
            title={`input ${row.recorded.inputTokens.toLocaleString()} · output ${row.recorded.outputTokens.toLocaleString()}`}
          >
            <span className="owb-budget-dash__recorded">
              {row.recorded.totalTokens.toLocaleString()}
            </span>
          </Tooltip>
        ),
      },
      {
        title: "状态",
        key: "state",
        width: 120,
        render: (_: unknown, row: BudgetRow) => {
          if (row.state === "exceeded") {
            return (
              <Tag className="owb-budget-dash__tag is-danger" bordered={false}>
                已超出
              </Tag>
            );
          }
          if (row.approaching) {
            return (
              <Tag className="owb-budget-dash__tag is-warning" bordered={false}>
                逼近 {budgetPercentText(row.ratio)}
              </Tag>
            );
          }
          if (row.state === "within") {
            return (
              <Tag className="owb-budget-dash__tag is-success" bordered={false}>
                声明内
              </Tag>
            );
          }
          return (
            <Tag className="owb-budget-dash__tag is-neutral" bordered={false}>
              无事实
            </Tag>
          );
        },
      },
    ],
    [],
  );

  if (loading) {
    return (
      <section className="owb-budget-dash" aria-label="预算成本看板">
        <div className="owb-budget-dash__summary" aria-label="摘要">
          {[0, 1, 2, 3].map((idx) => (
            <div className="owb-budget-dash__stat" key={idx}>
              <Skeleton.Input active size="small" />
            </div>
          ))}
        </div>
        <Skeleton
          active
          paragraph={{ rows: 4 }}
          title={false}
          aria-label="预算表格加载中"
        />
      </section>
    );
  }

  const openBudget = openId ? rows.find((row) => row.positionId === openId) ?? null : null;

  return (
    <section className="owb-budget-dash" aria-label="预算成本看板">
      <div className="owb-budget-dash__summary" role="group" aria-label="预算摘要">
        <div className="owb-budget-dash__stat" data-tone="neutral">
          <Statistic title="岗位" value={summary.total} />
        </div>
        <div className="owb-budget-dash__stat" data-tone="danger" data-testid="stat-exceeded">
          <Statistic
            title="超限"
            value={summary.exceeded}
            valueStyle={{
              color: summary.exceeded > 0 ? "var(--ui-danger)" : "var(--ui-foreground)",
            }}
          />
        </div>
        <div className="owb-budget-dash__stat" data-tone="warning">
          <Statistic
            title="逼近 (>=80%)"
            value={summary.approaching}
            valueStyle={{
              color: summary.approaching > 0 ? "var(--ui-warning)" : "var(--ui-foreground)",
            }}
          />
        </div>
        <div className="owb-budget-dash__stat" data-tone="neutral">
          <Statistic title="声明期" value={summary.unobserved} />
        </div>
      </div>

      {summary.exceeded > 0 ? (
        <Alert
          role="alert"
          data-testid="budget-summary-alert"
          className="owb-budget-dash__alert"
          type="error"
          showIcon
          message={`${summary.exceeded} 个岗位已超出单任务声明`}
          description="界不是预测，是已经发生的事实——点击表格中红条行查看详情。"
        />
      ) : null}

      <div className="owb-budget-dash__toolbar" role="group" aria-label="筛选与搜索">
        <Input.Search
          allowClear
          placeholder="按岗位 id / 名称过滤"
          className="owb-budget-dash__search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => setKeyword(value)}
        />
        <Segmented<FilterKey>
          value={filter}
          onChange={(value) => setFilter(value as FilterKey)}
          options={[
            { label: `全部 ${summary.total}`, value: "all" },
            { label: `超限 ${summary.exceeded}`, value: "exceeded" },
            { label: `逼近 ${summary.approaching}`, value: "approaching" },
            { label: `声明期 ${summary.unobserved}`, value: "declared" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <Empty
          className="owb-budget-dash__empty"
          description="尚无预算事实——为岗位完成招聘（hire = 预算随附）后此处点亮"
        />
      ) : visibleRows.length === 0 ? (
        <Empty className="owb-budget-dash__empty" description="该组合下没有预算事实" />
      ) : (
        <Table<BudgetRow>
          className="owb-budget-dash__table"
          rowKey="positionId"
          columns={columns}
          dataSource={visibleRows}
          pagination={false}
          size="middle"
          rowClassName={(row) => {
            const marks: string[] = [];
            if (row.state === "exceeded") marks.push("is-exceeded");
            else if (row.approaching) marks.push("is-approaching");
            return marks.join(" ");
          }}
          onRow={(row) => ({
            "data-position-id": row.positionId,
            "data-state": row.state,
            role: "button",
            tabIndex: 0,
            onClick: () => setOpenId(row.positionId),
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpenId(row.positionId);
              }
            },
          })}
        />
      )}

      {budgetRelatedEscalations.length > 0 ? (
        <div className="owb-budget-dash__escalations" aria-label="预算相关失败">
          <header>
            <AlertTriangle aria-hidden="true" size={14} />
            <h3>预算相关失败（{budgetRelatedEscalations.length}）</h3>
          </header>
          <ul>
            {budgetRelatedEscalations.map((entry) => (
              <li key={`${entry.positionId}-${entry.turnId}`}>
                <Badge status="error" />
                <strong>{positionNames?.[entry.positionId] ?? entry.positionId}</strong>
                <code>{entry.code}</code>
                <span className="owb-budget-dash__chain">
                  汇报链 {entry.reportingChain.join(" → ") || "—"}
                </span>
                {onOpenTimeline ? (
                  <button
                    type="button"
                    className="owb-budget-dash__linkbtn"
                    onClick={() => onOpenTimeline(entry.positionId)}
                  >
                    查看时间线
                    <ArrowUpRight aria-hidden="true" size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <BudgetDetailDrawer
        open={openBudget !== null}
        budget={openBudget}
        onClose={() => setOpenId(null)}
        onOpenTimeline={onOpenTimeline}
      />
    </section>
  );
}
