/**
 * P0 组织图可视化（体验追赶项）：把 org-tree.v1 应用态汇报树渲染成自上而下的
 * 节点图。纯展示组件——数据全部经 props 注入，不触 IPC；布局为纯 CSS flex +
 * 伪元素连接线（经典族谱树走线），不引图形库。
 *
 * 数据面口径：org-tree.v1 冻结面只携带 id / reportTo / budget / children
 * （shared org-tree.ts 注释：display names and modes live in workspace-org.v1
 * roles and are served via /positions/:id — the client never invents
 * semantics）。因此角色名 / title / mode 由调用方把已取到的 /positions/:id
 * 展示面以 displayNames / displayTitles / displayModes 注入（与侧栏树同源）；
 * 缺条目时回退岗位 id，绝不编造语义。汇报线走线之外，节点 tooltip 同时给出
 * 「汇报给 X」的文字面。
 */
import { useEffect, useRef, useState } from "react";
import { Empty, Skeleton, Tag, Tooltip } from "antd";
import type {
  OrgTreeNodeV1,
  OrgTreeSnapshot,
  PositionMode,
} from "@org-workbench/shared";
import { PositionAvatar } from "../PositionAvatar";

export interface OrgChartProps {
  /** 应用态快照；null 或空树 → 空态。 */
  snapshot: OrgTreeSnapshot | null;
  /** 加载态：骨架屏（treeLoading 同源）。 */
  loading?: boolean;
  /** 角色名（展示名）按岗位 id；缺省回退 id。 */
  displayNames?: Record<string, string>;
  /** 岗位 title 副行（如 metadata.title 提供）；缺省回退岗位 id。 */
  displayTitles?: Record<string, string>;
  /** mode 按岗位 id（/positions/:id 的 PositionCardData.mode）。 */
  displayModes?: Record<string, PositionMode>;
  /** 头像底色按岗位 id（metadata.color），与侧栏树/群聊同色。 */
  avatarColors?: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

const MODE_LABEL: Record<PositionMode, string> = {
  read_only: "只读",
  approval_required: "需审批",
};

/** 预算徽标：单任务上限的紧凑写法（40k/task）。token 优先（引擎按 token 计费），
 * 双无声明返回 null（不渲染，而不是编造数字）。与 App.tsx perTaskBudgetLabel
 * 同口径，但入参是 org-tree.v1 节点的 budget 声明面。 */
export function orgChartBudgetLabel(
  budget: OrgTreeNodeV1["budget"] | null | undefined,
): string | null {
  const perTask = budget?.perTask;
  if (!perTask) return null;
  if (typeof perTask.tokens === "number") {
    const k = perTask.tokens / 1000;
    const compact = k >= 1 ? `${Number.isInteger(k) ? k : k.toFixed(1)}k` : String(perTask.tokens);
    return `${compact}/task`;
  }
  if (typeof perTask.iterations === "number") return `${perTask.iterations} iter/task`;
  return null;
}

interface ChartNodeProps {
  node: OrgTreeNodeV1;
  displayNames?: Record<string, string>;
  displayTitles?: Record<string, string>;
  displayModes?: Record<string, PositionMode>;
  avatarColors?: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

function ChartNode({
  node,
  displayNames,
  displayTitles,
  displayModes,
  avatarColors,
  selectedId,
  onSelect,
}: ChartNodeProps) {
  const name = displayNames?.[node.id] ?? node.id;
  const title = displayTitles?.[node.id] ?? node.id;
  const mode = displayModes?.[node.id];
  const budgetLabel = orgChartBudgetLabel(node.budget);
  const selected = selectedId === node.id;
  const reportLine =
    node.reportTo === null
      ? "组织根（无上级汇报线）"
      : `汇报给 ${displayNames?.[node.reportTo] ?? node.reportTo}`;
  return (
    <div className="owb-org-chart__branch">
      <Tooltip title={`${name} · ${reportLine}`}>
        <button
          type="button"
          data-org-chart-node={node.id}
          className={`owb-org-chart__card${selected ? " is-selected" : ""}`}
          aria-pressed={selected}
          aria-label={`岗位 ${name}（${reportLine}）`}
          onClick={() => onSelect?.(node.id)}
        >
          <span className="owb-org-chart__card-head">
            <PositionAvatar
              colors={avatarColors}
              id={node.id}
              name={name}
              className="owb-org-chart__avatar"
            />
            <span className="owb-org-chart__card-text">
              <span className="owb-org-chart__name">{name}</span>
              <span className="owb-org-chart__title">{title}</span>
            </span>
          </span>
          <span className="owb-org-chart__card-foot">
            {budgetLabel ? (
              <span className="owb-org-chart__budget" title="单任务预算声明">
                {budgetLabel}
              </span>
            ) : (
              <span />
            )}
            {mode ? (
              <Tag
                bordered={false}
                color={mode === "approval_required" ? "processing" : "default"}
                className="owb-org-chart__mode"
              >
                {MODE_LABEL[mode]}
              </Tag>
            ) : null}
          </span>
        </button>
      </Tooltip>
      {node.children.length > 0 ? (
        <div className="owb-org-chart__children">
          {node.children.map((child) => (
            <ChartNode
              key={child.id}
              node={child}
              displayNames={displayNames}
              displayTitles={displayTitles}
              displayModes={displayModes}
              avatarColors={avatarColors}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 折叠态默认展开——收起只是把面积让给下面的对话面板，由使用者自己权衡，
 * 绝不是系统用固定高度替他做这个决定（那正是旧实现 240px 硬顶的问题）。 */
export function OrgChart({
  snapshot,
  loading = false,
  displayNames,
  displayTitles,
  displayModes,
  avatarColors,
  selectedId,
  onSelect,
  className,
}: OrgChartProps) {
  const empty = snapshot === null || snapshot.tree.length === 0;
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 选中岗位变化时自动定位：深层节点不再要求使用者手动滚动去找选中卡。
  useEffect(() => {
    if (!selectedId || collapsed) return;
    const target = bodyRef.current?.querySelector<HTMLElement>(
      `[data-org-chart-node="${CSS.escape(selectedId)}"]`,
    );
    if (!target) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [selectedId, collapsed, snapshot]);

  return (
    <section
      className={`owb-panel owb-org-chart${collapsed ? " is-collapsed" : ""}${className ? ` ${className}` : ""}`}
      aria-label="组织图"
    >
      <header className="owb-org-chart__head">
        <button
          type="button"
          className="owb-org-chart__toggle"
          aria-expanded={!collapsed}
          aria-controls="owb-org-chart-body"
          aria-label={collapsed ? "展开组织图" : "折叠组织图"}
          title={collapsed ? "展开组织图" : "折叠组织图"}
          onClick={() => setCollapsed((v) => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="owb-org-chart__head-title">组织图</span>
        {snapshot && !empty ? (
          <span className="owb-muted">
            {snapshot.positionCount} 岗位 · 深度 {snapshot.depth}
          </span>
        ) : null}
      </header>
      <div className="owb-org-chart__body" id="owb-org-chart-body" ref={bodyRef}>
        {loading ? (
          <div className="owb-org-chart__loading" aria-label="组织图加载中">
            <Skeleton active title={false} paragraph={{ rows: 3 }} />
          </div>
        ) : empty ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无组织数据" />
        ) : (
          <div className="owb-org-chart__stage">
            <div className="owb-org-chart__roots">
              {snapshot.tree.map((root) => (
                <ChartNode
                  key={root.id}
                  node={root}
                  displayNames={displayNames}
                  displayTitles={displayTitles}
                  displayModes={displayModes}
                  avatarColors={avatarColors}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
