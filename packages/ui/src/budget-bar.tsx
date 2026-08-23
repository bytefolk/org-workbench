import { TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@fullstack-ai-infra/ui";
import { capsText, primaryCap, type BudgetCaps } from "./types";

export interface BudgetBarProps {
  /** Budget declaration of one position (perTask → taskLimit, perDay → dailyLimit). null = 预算未配齐. */
  declared: { taskLimit: BudgetCaps | null; dailyLimit: BudgetCaps | null } | null;
  /** Consumption ratio (0..1+). null = declaration phase (D1); provided = consumption phase (D3+). */
  consumption?: number | null;
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
        <BudgetLane label="单日" caps={declared.dailyLimit} consumption={consumption} />
      </div>
    </div>
  );
}

function BudgetLane({
  label,
  caps,
  consumption,
}: {
  label: string;
  caps: BudgetCaps | null;
  consumption: number | null;
}) {
  const cap = primaryCap(caps);
  const declarationMode = consumption === null;
  const ratio = cap && consumption !== null ? consumption : null;
  const laneClass = declarationMode ? "is-declared" : ratio === null ? "is-declared" : tierClass(ratio);
  const fillWidth =
    ratio === null
      ? "100%"
      : `${Math.min(Math.max(Math.round(ratio * 100), 0), 100)}%`;
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
        aria-label={`${label}${declarationMode ? "声明" : "消耗"}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
      >
        <span className="ui-org-budget__fill" style={meterProps ?? undefined} />
      </span>
      <span className="ui-org-budget__value">
        {declarationMode ? capsText(caps) : `${Math.round((ratio ?? 0) * 100)}%`}
      </span>
    </div>
  );
}
