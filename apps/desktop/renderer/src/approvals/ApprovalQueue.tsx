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
import { Alert, Badge, Empty, List, Segmented, Tag, Tooltip } from "antd";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import {
  APPROVAL_CATEGORY_LABEL,
  isDecided,
  isPermissionOverreach,
  type ApprovalCategory,
  type ApprovalQueueCallbacks,
  type ApprovalQueueItem,
} from "./types";
import { ApprovalDetailDrawer } from "./ApprovalDetailDrawer";

export type ApprovalQueueFilter = "pending" | "decided" | "all";

export interface ApprovalQueueProps extends ApprovalQueueCallbacks {
  items: ApprovalQueueItem[];
  loading?: boolean;
  /** Read failure banner (e.g., control plane unreachable). Kept as a
   * plain message; App wires the actual apiErrorMessage in. */
  errorMessage?: string;
  defaultFilter?: ApprovalQueueFilter;
}

const FILTER_OPTIONS: { label: string; value: ApprovalQueueFilter }[] = [
  { label: "\u5f85\u88c1\u51b3", value: "pending" },
  { label: "\u5df2\u88c1\u51b3", value: "decided" },
  { label: "\u5168\u90e8", value: "all" },
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
      return "\u5f85\u88c1\u51b3";
    case "granted":
      return "\u5df2\u6279\u51c6";
    case "denied":
      return "\u5df2\u62d2\u7edd";
    case "expired":
      return "\u5df2\u8fc7\u671f";
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
    <section className="owb-approval-queue" aria-label="\u5ba1\u6279\u961f\u5217">
      <header className="owb-approval-queue__hero">
        <div>
          <span className="owb-approval-queue__eyebrow">LOCAL CONTROL PLANE</span>
          <h1 className="owb-approval-queue__title">\u5ba1\u6279\u961f\u5217</h1>
          <p className="owb-approval-queue__lede">
            \u6c47\u603b\u6563\u843d\u5728\u5404\u5c97\u4f4d\u56de\u5408\u91cc\u7684 <code>approval.requested</code>\uff1b\u6279\u51c6 / \u62d2\u7edd\u968f\u4e0b\u4e00\u56de\u5408\u7684
            <code> pendingApproval</code> \u4e0b\u53d1\uff0c\u672c\u9875\u4e0d\u53d1\u8fd0\u884c\u4e2d\u901a\u9053\u3002
          </p>
        </div>
        <div className="owb-approval-queue__badge" aria-label={`\u5f85\u88c1\u51b3 ${pendingCount}`}>
          <Badge count={pendingCount} showZero={false} color="var(--ui-primary)">
            <ShieldAlert aria-hidden="true" size={22} />
          </Badge>
        </div>
      </header>

      <div className="owb-approval-queue__toolbar" role="toolbar" aria-label="\u5ba1\u6279\u8fc7\u6ee4">
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as ApprovalQueueFilter)}
          options={FILTER_OPTIONS}
          aria-label="\u6309\u72b6\u6001\u8fc7\u6ee4"
        />
      </div>

      {errorMessage ? (
        <Alert
          type="warning"
          showIcon
          message="\u63a7\u5236\u9762\u4e0d\u53ef\u8fbe\uff0c\u961f\u5217\u6682\u505c\u5237\u65b0"
          description={errorMessage}
          className="owb-approval-queue__banner"
        />
      ) : null}

      {loading ? (
        <div className="owb-approval-queue__loading" aria-label="\u5ba1\u6279\u961f\u5217\u52a0\u8f7d\u4e2d">
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
        <Empty
          image={<ShieldCheck aria-hidden="true" size={40} />}
          description={
            filter === "pending"
              ? "\u6ca1\u6709\u7b49\u5f85\u5ba1\u6279\u7684\u52a8\u4f5c \u2014\u2014 \u6240\u6709\u56de\u5408\u90fd\u5728\u754c\u5185\u8fd0\u884c"
              : "\u8be5\u8fc7\u6ee4\u4e0b\u6ca1\u6709\u6761\u76ee"
          }
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

interface ApprovalCardProps {
  item: ApprovalQueueItem;
  onOpen: () => void;
}

function ApprovalCard({ item, onOpen }: ApprovalCardProps) {
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
        aria-label={`\u5ba1\u6279 ${item.approvalId}`}
      >
        <div className="owb-approval-card__head">
          <span className="owb-approval-card__eyebrow">APPROVAL \u00b7 CAPABILITY GATE</span>
          <span className="owb-approval-card__tags">
            <Tag color={CATEGORY_TAG_COLOR[item.category]}>
              {APPROVAL_CATEGORY_LABEL[item.category]}
            </Tag>
            {overreach ? (
              <Tag color="red" data-testid="approval-overreach-tag">
                \u8d8a\u6743\u5c1d\u8bd5
              </Tag>
            ) : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                \u6a21\u5f0f {item.positionMode === "read_only" ? "\u53ea\u8bfb" : "\u9700\u6279\u51c6"}
              </Tag>
            ) : null}
            <Tag color={decisionTagColor}>{decisionLabel(item)}</Tag>
          </span>
        </div>
        <div className="owb-approval-card__title">
          <strong>{item.positionName ?? item.positionId}</strong>
          <span className="owb-approval-card__pid">{item.positionId}</span>
        </div>
        <p className="owb-approval-card__description" title={item.description}>
          {item.description}
        </p>
        {item.target ? (
          <p className="owb-approval-card__target" title={item.target}>
            {item.target}
          </p>
        ) : null}
        <p className="owb-approval-card__meta">
          {item.expiresAt ? (
            <Tooltip title={item.expiresAt}>
              <span className="owb-approval-card__expires">\u8fc7\u671f {item.expiresAt}</span>
            </Tooltip>
          ) : null}
          <span className="owb-approval-card__aid">{item.approvalId}</span>
        </p>
      </button>
    </article>
  );
}
