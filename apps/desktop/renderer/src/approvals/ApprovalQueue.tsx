/**
 * ApprovalQueue (design spec §5 · approval / overreach event queue)
 *
 * Reads a props-injected `items: ApprovalQueueItem[]` and renders a queue
 * of approval cards. Wired-in interactions (approve / deny) forward via
 * `callbacks` up to App.tsx, which is responsible for building the
 * `pendingApproval`-carrying resume turn.
 *
 * DATA GAP (TODO, v0):
 *   v0 has no dedicated `/approvals` HTTP stream; items are supplied by the
 *   host. v1 derives the list from bounded turn-history scan + SSE
 *   `turn.approval.requested`. UI shape is stable across that swap.
 */
import { useMemo, useState } from "react";
import { Alert, Button, List, Segmented, Tag, Tooltip } from "antd";
import { ArrowRight, Clock3, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  APPROVAL_CATEGORY_LABEL,
  isDecided,
  isPermissionOverreach,
  type ApprovalCategory,
  type ApprovalQueueCallbacks,
  type ApprovalQueueItem,
} from "./types";
import { ApprovalDetailDrawer } from "./ApprovalDetailDrawer";
import { decodeEscapedUnicode } from "../display-text";

export type ApprovalQueueFilter = "pending" | "decided" | "all";
export type ApprovalQueueDataState = "ready" | "not-connected";

export interface ApprovalQueueProps extends ApprovalQueueCallbacks {
  items: ApprovalQueueItem[];
  loading?: boolean;
  /** Read failure banner (e.g., control plane unreachable). Kept as a
   * plain message; App wires the actual apiErrorMessage in. */
  errorMessage?: string;
  defaultFilter?: ApprovalQueueFilter;
  /** `not-connected` is used when the host has not started deriving items
   * from turn history/SSE yet; it must not be presented as a real zero. */
  dataState?: ApprovalQueueDataState;
  onNavigateToOrg?: () => void;
}

const FILTER_OPTIONS: { label: string; value: ApprovalQueueFilter }[] = [
  { label: "待裁决", value: "pending" },
  { label: "已裁决", value: "decided" },
  { label: "全部", value: "all" },
];

const CATEGORY_TAG_COLOR: Record<ApprovalCategory, string> = {
  exec: "purple",
  write: "geekblue",
  network: "cyan",
  tool: "default",
};

function decisionLabel(item: ApprovalQueueItem): string {
  switch (item.decision.kind) {
    case "pending":
      return "待裁决";
    case "granted":
      return "已批准";
    case "denied":
      return "已拒绝";
    case "expired":
      return "已过期";
  }
}

function decisionCssState(item: ApprovalQueueItem): string {
  return item.decision.kind;
}

export function ApprovalQueue({
  items,
  loading,
  errorMessage,
  defaultFilter = "pending",
  dataState = "ready",
  onNavigateToOrg,
  onApprove,
  onDeny,
}: ApprovalQueueProps) {
  const [filter, setFilter] = useState<ApprovalQueueFilter>(defaultFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => items.filter((item) => item.decision.kind === "pending").length,
    [items],
  );

  const visible = useMemo(() => {
    if (filter === "pending") return items.filter((item) => !isDecided(item));
    if (filter === "decided") return items.filter((item) => isDecided(item));
    return items;
  }, [items, filter]);

  const selectedItem = useMemo(
    () => items.find((item) => item.approvalId === selectedId) ?? null,
    [items, selectedId],
  );

  return (
    <section className="owb-approval-queue" aria-label="审批中心">
      <header className="owb-approval-queue__hero">
        <div className="owb-approval-queue__hero-copy">
          <span className="owb-approval-queue__eyebrow">LOCAL CONTROL PLANE</span>
          <div className="owb-approval-queue__title-row">
            <h1 className="owb-approval-queue__title">审批中心</h1>
            <span className={`owb-approval-queue__state is-${dataState}`}>
              <span aria-hidden="true" />
              {dataState === "ready" ? "数据已接入" : "数据源未接入"}
            </span>
          </div>
          <p className="owb-approval-queue__lede">
            Agent 遇到需要人工确认的命令、写入、联网或受限工具调用时，会在这里暂停。
            你可以查看动作目标和有效期，批准或拒绝后，裁决会随下一回合留痕下发；正常回合不会经过此页。
          </p>
        </div>
        <div className="owb-approval-queue__metric" aria-label={`待裁决 ${pendingCount}`}>
          <span className="owb-approval-queue__metric-icon" aria-hidden="true">
            <ShieldAlert size={18} />
          </span>
          <span className="owb-approval-queue__metric-copy">
            <strong>{pendingCount}</strong>
            <span>待裁决</span>
          </span>
        </div>
      </header>

      <div className="owb-approval-queue__toolbar" role="toolbar" aria-label="审批过滤">
        <div className="owb-approval-queue__filter-label">
          <span>裁决状态</span>
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as ApprovalQueueFilter)}
            options={FILTER_OPTIONS}
            aria-label="按状态过滤"
          />
        </div>
        <span className="owb-approval-queue__count">共 {items.length} 条记录</span>
      </div>

      {errorMessage ? (
        <Alert
          type="warning"
          showIcon
          message="控制面不可达，队列暂停刷新"
          description={errorMessage}
          className="owb-approval-queue__banner"
        />
      ) : null}

      {loading ? (
        <div className="owb-approval-queue__loading" aria-label="审批队列加载中">
          <List
            dataSource={[0, 1, 2]}
            renderItem={(key) => (
              <List.Item key={key}>
                <div className="owb-approval-card is-skeleton" />
              </List.Item>
            )}
          />
        </div>
      ) : visible.length === 0 ? (
        <ApprovalEmptyState
          filter={filter}
          dataState={dataState}
          onNavigateToOrg={onNavigateToOrg}
        />
      ) : (
        <List
          className="owb-approval-queue__list"
          dataSource={visible}
          rowKey={(item) => item.approvalId}
          renderItem={(item) => (
            <List.Item className="owb-approval-queue__item">
              <ApprovalCard
                item={item}
                onOpen={() => setSelectedId(item.approvalId)}
              />
            </List.Item>
          )}
        />
      )}

      <ApprovalDetailDrawer
        open={selectedItem !== null}
        item={selectedItem}
        onClose={() => setSelectedId(null)}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </section>
  );
}

function ApprovalEmptyState({
  filter,
  dataState,
  onNavigateToOrg,
}: {
  filter: ApprovalQueueFilter;
  dataState: ApprovalQueueDataState;
  onNavigateToOrg?: () => void;
}) {
  const disconnected = dataState === "not-connected";
  const title = disconnected
    ? "审批列表还未接入回合数据"
    : filter === "pending"
      ? "没有等待审批的动作"
      : filter === "decided"
        ? "该筛选下没有已裁决记录"
        : "暂无审批记录";
  const description = disconnected
    ? "当前版本已经提供审批协议和裁决面板，但还没有从回合历史与事件流汇总出列表。因此这里的 0 不代表系统已经确认没有审批。"
    : filter === "pending"
      ? "已读取的回合中没有处于暂停状态的能力请求。需要人工确认时，会在这里展示动作、目标、岗位和过期时间。"
      : filter === "decided"
        ? "批准或拒绝的结果会保留在回合证据中，并出现在这里。"
        : "当 Agent 触发需要人工确认的动作后，审批记录会显示在这里。";

  return (
    <section className={`owb-approval-queue__empty is-${disconnected ? "disconnected" : filter}`}>
      <div className="owb-approval-queue__empty-icon" aria-hidden="true">
        {disconnected ? <Clock3 size={24} /> : <ShieldCheck size={26} />}
      </div>
      <span className="owb-approval-queue__empty-kicker">
        {disconnected ? "QUEUE CONNECTION" : "NO ACTION REQUIRED"}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="owb-approval-queue__rules" aria-label="审批规则说明">
        <div>
          <strong>什么时候出现</strong>
          <span>命令执行、文件写入、网络访问或受限工具调用需要人工判断时</span>
        </div>
        <div>
          <strong>怎么处理</strong>
          <span>打开条目核对目标和有效期，再选择批准并继续或拒绝</span>
        </div>
      </div>
      {disconnected && onNavigateToOrg ? (
        <Button type="default" onClick={onNavigateToOrg} icon={<ArrowRight size={14} />}>
          返回组织模块
        </Button>
      ) : null}
    </section>
  );
}

interface ApprovalCardProps {
  item: ApprovalQueueItem;
  onOpen: () => void;
}

function ApprovalCard({ item, onOpen }: ApprovalCardProps) {
  const positionName = decodeEscapedUnicode(item.positionName ?? item.positionId);
  const description = decodeEscapedUnicode(item.description);
  const target = item.target ? decodeEscapedUnicode(item.target) : undefined;
  const overreach = isPermissionOverreach(item);
  const decided = isDecided(item);
  const decisionTagColor = !decided
    ? "blue"
    : item.decision.kind === "granted"
      ? "green"
      : item.decision.kind === "denied"
        ? "red"
        : "default";
  return (
    <article
      className="owb-approval-card"
      data-testid={`approval-card-${item.approvalId}`}
      data-approval-id={item.approvalId}
      data-decision-state={decisionCssState(item)}
      data-overreach={overreach ? "true" : "false"}
      data-decided={decided ? "true" : "false"}
      onClick={onOpen}
    >
      <button
        type="button"
        className="owb-approval-card__row"
        onClick={onOpen}
        aria-label={`审批 ${item.approvalId}`}
      >
        <div className="owb-approval-card__head">
          <span className="owb-approval-card__eyebrow">APPROVAL · CAPABILITY GATE</span>
          <span className="owb-approval-card__tags">
            <Tag color={CATEGORY_TAG_COLOR[item.category]}>
              {APPROVAL_CATEGORY_LABEL[item.category]}
            </Tag>
            {overreach ? (
              <Tag color="red" data-testid="approval-overreach-tag">
                越权尝试
              </Tag>
            ) : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                模式 {item.positionMode === "read_only" ? "只读" : "需批准"}
              </Tag>
            ) : null}
            <Tag color={decisionTagColor}>{decisionLabel(item)}</Tag>
          </span>
        </div>
        <div className="owb-approval-card__title">
          <strong>{positionName}</strong>
          <span className="owb-approval-card__pid">{item.positionId}</span>
        </div>
        <p className="owb-approval-card__description" title={description}>
          {description}
        </p>
        {target ? (
          <p className="owb-approval-card__target" title={target}>
            {target}
          </p>
        ) : null}
        <p className="owb-approval-card__meta">
          {item.expiresAt ? (
            <Tooltip title={item.expiresAt}>
              <span className="owb-approval-card__expires">过期 {formatApprovalTime(item.expiresAt)}</span>
            </Tooltip>
          ) : null}
          <span className="owb-approval-card__aid">{item.approvalId}</span>
        </p>
      </button>
    </article>
  );
}

function formatApprovalTime(value?: string): string {
  if (!value) return "未声明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
