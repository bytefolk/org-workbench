import { TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@fullstack-ai-infra/ui";
import { capsText, primaryCap, type BudgetCaps } from "./types";

export interface BudgetBarProps {
  /** Budget declaration of one position (perTask → taskLimit, perDay → dailyLimit). null = 预算未配齐. */
  declared: { taskLimit: BudgetCaps | null; dailyLimit: BudgetCaps | null } | null;
  /** Per-task consumption ratio (0..1+). null = declaration phase. */
  consumption?: number | null;
  /** Per-day window ratio. Omit when no truthful day bucket exists. */
  dailyConsumption?: number | null;
  format?: "compact" | "full";
  label?: string;
  className?: string;
}

const TIER_WARNING = 0.8;

function tierClass(ratio: number): string {
  if (ratio > 1) return "is-over";
  if (ratio >= TIER_WARNING) return "is-warning";
  return "is-ok";
}

/**
 * BudgetBar — dual-phase contract (D1 spec §4):
 *  - Phase 1 (declaration): consumption=null renders declared caps without a
 *    percentage; budget-not-allocated renders a warning soft badge (mirrors
 *    the org apply budget gate).
 *  - Phase 2 (consumption, D3+): three-tier color scale (<80% success /
 *    80–100% warning / >100% danger).
 * Colors are semantic tokens only — never raw hex.
 */
export function BudgetBar({
  declared,
  consumption = null,
  dailyConsumption,
  format = "full",
  label,
  className,
}: BudgetBarProps) {
  if (!declared) {
    return (
      <span
        className={cn("ui-org-budget", "ui-org-budget--missing", className)}
        role="status"
      >
        <TriangleAlert aria-hidden="true" size={12} />
        预算未配齐
      </span>
    );
  }
  if (format === "compact") {
    return (
      <div className={cn("ui-org-budget", "is-compact", className)}>
        <BudgetLane
          label={label ?? "预算"}
          caps={declared.taskLimit}
          consumption={consumption}
        />
      </div>
    );
  }
  return (
    <div className={cn("ui-org-budget", className)}>
      <div className="ui-org-budget__lanes">
        <BudgetLane label="单任务" caps={declared.taskLimit} consumption={consumption} />
        <BudgetLane
          label="单日"
          caps={declared.dailyLimit}
          consumption={consumption === null && dailyConsumption === undefined ? null : dailyConsumption}
        />
      </div>
    </div>
  );
}

/** Declared caps with the primary number emphasised (设计稿 .val b):
 * `<b>20,000 tokens</b> · 8 iterations`. Falls back to em dash when the
 * declaration carries no cap at all — never invents a number. */
function DeclaredCaps({ caps }: { caps: BudgetCaps | null | undefined }) {
  const text = capsText(caps);
  if (text === "—") return <>未声明</>;
  const [head, ...rest] = text.split(" · ");
  return (
    <>
      <b>{head}</b>
      {rest.length > 0 ? ` · ${rest.join(" · ")}` : null}
    </>
  );
}

function BudgetLane({
  label,
  caps,
  consumption,
}: {
  label: string;
  caps: BudgetCaps | null;
  consumption: number | null | undefined;
}) {
  const cap = primaryCap(caps);
  const declarationMode = consumption === null;
  const unavailable = consumption === undefined;
  const ratio = cap && typeof consumption === "number" ? consumption : null;
  const laneClass = declarationMode || unavailable || ratio === null ? "is-declared" : tierClass(ratio);
  // #77 review item 4：>100% 不夹到 100——spec 要求超限超长出界呈现（116%
  // 出界不截断圆角），夹到 100 会让超限和刚好用满看起来一样。
  const percent = ratio === null ? null : Math.max(Math.round(ratio * 100), 0);
  const fillWidth = percent === null ? "100%" : `${percent}%`;
  const meterProps: CSSProperties | undefined =
    ratio === null
      ? undefined
      : { width: fillWidth };
  return (
    <div className="ui-org-budget__lane">
      <span className="ui-org-budget__lane-label">{label}</span>
      <span
        className={cn("ui-org-budget__track", laneClass)}
        role="meter"
        aria-label={`${label}${declarationMode ? "声明" : unavailable ? "用量不可用" : "消耗"}`}
        aria-valuemin={0}
        // valuemax 必须 >= valuenow（ARIA 合法性）：正常态定死 100，超限时
        // 跟实际读数一起涨，不能一边报 116 一边把上限钉在 100。
        aria-valuemax={ratio === null ? 100 : Math.max(100, percent ?? 0)}
        aria-valuenow={ratio === null ? undefined : percent ?? undefined}
      >
        <span className="ui-org-budget__fill" style={meterProps ?? undefined} />
      </span>
      <span className="ui-org-budget__value">
        {declarationMode ? (
          <DeclaredCaps caps={caps} />
        ) : unavailable ? (
          <>未记录 · 上限 <DeclaredCaps caps={caps} /></>
        ) : (
          `${Math.round((ratio ?? 0) * 100)}%`
        )}
      </span>
    </div>
  );
}
