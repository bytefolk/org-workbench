/**
 * ApprovalDetailDrawer (design spec §5.1 · verdict panel)
 *
 * Right-side drawer that lets the operator inspect one approval and
 * approve / deny it. Interaction is deliberately dumb: it forwards the
 * verdict up via callbacks; the host owns the "carry pendingApproval in the
 * next resume turn" work (see App.tsx `onVerdictTurn`). Once an item is
 * decided (or expired), inputs and action buttons are locked so nothing can
 * be re-judged.
 *
 * DATA GAP (TODO, v0):
 *   Evidence list (turn-evidence.v1) is intentionally omitted at P0. Wiring
 *   evidence in requires the v1 bounded-scan path; keep the visual slot but
 *   render a placeholder so the design language does not drift.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Input, Space, Tag } from "antd";
import {
  APPROVAL_CATEGORY_LABEL,
  isDecided,
  isPermissionOverreach,
  type ApprovalQueueCallbacks,
  type ApprovalQueueItem,
} from "./types";
import { decodeEscapedUnicode } from "../display-text";
// Mirrors packages/shared/pending-approval.cjs MAX_APPROVAL_REASON_BYTES.
// Inlined here because the shared module transitively uses `node:module`
// createRequire and cannot be bundled for the renderer.
const MAX_APPROVAL_REASON_BYTES = 1024;

export interface ApprovalDetailDrawerProps extends ApprovalQueueCallbacks {
  open: boolean;
  item: ApprovalQueueItem | null;
  onClose: () => void;
}

export function ApprovalDetailDrawer({
  open,
  item,
  onClose,
  onApprove,
  onDeny,
}: ApprovalDetailDrawerProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    // Reset the reason field whenever the drawer switches to a different
    // approval or closes; do not leak reasons across items.
    setReason("");
  }, [item?.approvalId, open]);

  if (!item) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        width={420}
        title="审批详情"
        destroyOnClose
      />
    );
  }

  const decided = isDecided(item);
  const overreach = isPermissionOverreach(item);
  const expired = item.decision.kind === "expired";
  const disabled = decided || expired;
  const positionName = decodeEscapedUnicode(item.positionName ?? item.positionId);
  const description = decodeEscapedUnicode(item.description);
  const target = item.target ? decodeEscapedUnicode(item.target) : undefined;
  const trimmedReason = reason.trim();
  const reasonForCallback = trimmedReason.length === 0 ? undefined : trimmedReason;

  const handleApprove = () => {
    if (disabled) return;
    onApprove(item.approvalId, reasonForCallback);
  };
  const handleDeny = () => {
    if (disabled) return;
    onDeny(item.approvalId, reasonForCallback);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      title={`审批详情 · ${APPROVAL_CATEGORY_LABEL[item.category]}`}
      destroyOnClose
      data-testid="approval-detail-drawer"
    >
      <div className="owb-approval-drawer" data-approval-id={item.approvalId}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="owb-approval-drawer__meta">
            <Tag color="purple">{APPROVAL_CATEGORY_LABEL[item.category]}</Tag>
            {overreach ? <Tag color="red">越权尝试</Tag> : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                模式 {item.positionMode === "read_only" ? "只读" : "需批准"}
              </Tag>
            ) : null}
          </div>

          <section>
            <h3 className="owb-approval-drawer__section-title">请求岗位</h3>
            <p className="owb-approval-drawer__position">
              <strong>{positionName}</strong>
              <span className="owb-approval-drawer__pid">{item.positionId}</span>
            </p>
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">动作描述</h3>
            <p className="owb-approval-drawer__description">{description}</p>
            {target ? (
              <p className="owb-approval-drawer__target">
                目标：<code>{target}</code>
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">时限与 ID</h3>
            <p className="owb-approval-drawer__meta-line">
              {item.expiresAt ? (
                <span>过期：<code>{item.expiresAt}</code></span>
              ) : (
                <span className="owb-muted">未声明过期时间</span>
              )}
              <span>approvalId：<code>{item.approvalId}</code></span>
            </p>
          </section>

          {decided ? (
            <Alert
              type={item.decision.kind === "granted" ? "success" : item.decision.kind === "denied" ? "error" : "info"}
              message={
                item.decision.kind === "granted"
                  ? "已批准——裁决已随新回合下发"
                  : item.decision.kind === "denied"
                    ? "已拒绝——拒绝证据永久保留"
                    : "已过期——如需放行请发起新回合"
              }
              description={
                item.decision.kind === "denied" && item.decision.reason
                  ? `拒绝理由：${item.decision.reason}`
                  : undefined
              }
              showIcon
            />
          ) : (
            <section>
              <h3 className="owb-approval-drawer__section-title">拒绝理由（可选）</h3>
              <Input.TextArea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="不填则成为无理由拒绝；将随 resume 回合封入证据。"
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={MAX_APPROVAL_REASON_BYTES}
                showCount
                data-testid="approval-reason-input"
                disabled={disabled}
              />
            </section>
          )}

          <div className="owb-approval-drawer__actions">
            <Button
              type="primary"
              onClick={handleApprove}
              disabled={disabled}
              data-testid="approval-approve-button"
            >
              批准并继续
            </Button>
            <Button
              danger
              onClick={handleDeny}
              disabled={disabled}
              data-testid="approval-deny-button"
            >
              拒绝
            </Button>
          </div>

          {/* Evidence slot is a placeholder at P0 (see file-level TODO). */}
          <section className="owb-approval-drawer__evidence" aria-label="回合证据">
            <h3 className="owb-approval-drawer__section-title">回合证据</h3>
            <p className="owb-muted">证据列表待 v1 就绪（turn-evidence.v1 有界扫描 + SSE）。</p>
          </section>
        </Space>
      </div>
    </Drawer>
  );
}
