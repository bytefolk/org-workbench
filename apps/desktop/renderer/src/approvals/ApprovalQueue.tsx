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
import { useT, type OwbT } from "@org-workbench/ui";
import {
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

const FILTER_OPTIONS: { labelKey: string; value: ApprovalQueueFilter }[] = [
  { labelKey: "apr.filterPending", value: "pending" },
  { labelKey: "apr.filterDecided", value: "decided" },
  { labelKey: "apr.filterAll", value: "all" },
];

const CATEGORY_TAG_COLOR: Record<ApprovalCategory, string> = {
  exec: "purple",
  write: "geekblue",
  network: "cyan",
  tool: "default",
};

function decisionLabel(item: ApprovalQueueItem, t: OwbT): string {
  switch (item.decision.kind) {
    case "pending":
      return t("apr.filterPending");
    case "granted":
      return t("apr.decisionGranted");
    case "denied":
      return t("apr.decisionDenied");
    case "expired":
      return t("apr.decisionExpired");
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
  const t = useT();
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
    <section className="owb-approval-queue" aria-label={t("apr.queue")}>
      <header className="owb-approval-queue__hero">
        <div>
          <span className="owb-approval-queue__eyebrow">LOCAL CONTROL PLANE</span>
          <h1 className="owb-approval-queue__title">{t("apr.queue")}</h1>
          <p className="owb-approval-queue__lede">
            {t("apr.queueLedeA")}<code>approval.requested</code>{t("apr.queueLedeB")}
            <code> pendingApproval</code>{t("apr.queueLedeC")}
          </p>
        </div>
        <div className="owb-approval-queue__badge" aria-label={t("apr.pendingBadge", { count: pendingCount })}>
          <Badge count={pendingCount} showZero={false} color="var(--ui-primary)">
            <ShieldAlert aria-hidden="true" size={22} />
          </Badge>
        </div>
      </header>

      <div className="owb-approval-queue__toolbar" role="toolbar" aria-label={t("apr.filterAria")}>
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as ApprovalQueueFilter)}
          options={FILTER_OPTIONS.map((option) => ({ label: t(option.labelKey), value: option.value }))}
          aria-label={t("apr.filterStateAria")}
        />
      </div>

      {errorMessage ? (
        <Alert
          type="warning"
          showIcon
          message={t("apr.offlineBanner")}
          description={errorMessage}
          className="owb-approval-queue__banner"
        />
      ) : null}

      {loading ? (
        <div className="owb-approval-queue__loading" aria-label={t("apr.queueLoading")}>
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
              ? t("apr.emptyPending")
              : t("apr.emptyFiltered")
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
  const t = useT();
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
        aria-label={t("apr.cardAria", { id: item.approvalId })}
      >
        <div className="owb-approval-card__head">
          <span className="owb-approval-card__eyebrow">APPROVAL \u00b7 CAPABILITY GATE</span>
          <span className="owb-approval-card__tags">
            <Tag color={CATEGORY_TAG_COLOR[item.category]}>
              {t(`apr.kind.${item.category}`)}
            </Tag>
            {overreach ? (
              <Tag color="red" data-testid="approval-overreach-tag">
                {t("apr.overreach")}
              </Tag>
            ) : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                {t("apr.modeTag", { mode: item.positionMode === "read_only" ? t("pos.readOnly") : t("pos.approval") })}
              </Tag>
            ) : null}
            <Tag color={decisionTagColor}>{decisionLabel(item, t)}</Tag>
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
              <span className="owb-approval-card__expires">{t("apr.expires", { at: item.expiresAt })}</span>
            </Tooltip>
          ) : null}
          <span className="owb-approval-card__aid">{item.approvalId}</span>
        </p>
      </button>
    </article>
  );
}
