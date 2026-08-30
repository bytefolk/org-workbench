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
        title="\u5ba1\u6279\u8be6\u60c5"
        destroyOnClose
      />
    );
  }

  const decided = isDecided(item);
  const overreach = isPermissionOverreach(item);
  const expired = item.decision.kind === "expired";
  const disabled = decided || expired;
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
      title={`\u5ba1\u6279\u8be6\u60c5 \u00b7 ${APPROVAL_CATEGORY_LABEL[item.category]}`}
      destroyOnClose
      data-testid="approval-detail-drawer"
    >
      <div className="owb-approval-drawer" data-approval-id={item.approvalId}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="owb-approval-drawer__meta">
            <Tag color="purple">{APPROVAL_CATEGORY_LABEL[item.category]}</Tag>
            {overreach ? <Tag color="red">\u8d8a\u6743\u5c1d\u8bd5</Tag> : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                \u6a21\u5f0f {item.positionMode === "read_only" ? "\u53ea\u8bfb" : "\u9700\u6279\u51c6"}
              </Tag>
            ) : null}
          </div>

          <section>
            <h3 className="owb-approval-drawer__section-title">\u8bf7\u6c42\u5c97\u4f4d</h3>
            <p className="owb-approval-drawer__position">
              <strong>{item.positionName ?? item.positionId}</strong>
              <span className="owb-approval-drawer__pid">{item.positionId}</span>
            </p>
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">\u52a8\u4f5c\u63cf\u8ff0</h3>
            <p className="owb-approval-drawer__description">{item.description}</p>
            {item.target ? (
              <p className="owb-approval-drawer__target">
                \u76ee\u6807\uff1a<code>{item.target}</code>
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">\u65f6\u9650\u4e0e ID</h3>
            <p className="owb-approval-drawer__meta-line">
              {item.expiresAt ? (
                <span>\u8fc7\u671f\uff1a<code>{item.expiresAt}</code></span>
              ) : (
                <span className="owb-muted">\u672a\u58f0\u660e\u8fc7\u671f\u65f6\u95f4</span>
              )}
              <span>approvalId\uff1a<code>{item.approvalId}</code></span>
            </p>
          </section>

          {decided ? (
            <Alert
              type={item.decision.kind === "granted" ? "success" : item.decision.kind === "denied" ? "error" : "info"}
              message={
                item.decision.kind === "granted"
                  ? "\u5df2\u6279\u51c6\u2014\u2014\u88c1\u51b3\u5df2\u968f\u65b0\u56de\u5408\u4e0b\u53d1"
                  : item.decision.kind === "denied"
                    ? "\u5df2\u62d2\u7edd\u2014\u2014\u62d2\u7edd\u8bc1\u636e\u6c38\u4e0d\u6d88\u5931"
                    : "\u5df2\u8fc7\u671f\u2014\u2014\u5982\u9700\u653e\u884c\u8bf7\u53d1\u8d77\u65b0\u56de\u5408"
              }
              description={
                item.decision.kind === "denied" && item.decision.reason
                  ? `\u62d2\u7edd\u7406\u7531\uff1a${item.decision.reason}`
                  : undefined
              }
              showIcon
            />
          ) : (
            <section>
              <h3 className="owb-approval-drawer__section-title">\u62d2\u7edd\u7406\u7531\uff08\u53ef\u9009\uff09</h3>
              <Input.TextArea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="\u4e0d\u586b\u5219\u6210\u4e3a\u65e0\u7406\u7531\u62d2\u7edd\uff1b\u5c06\u968f resume \u56de\u5408\u5c01\u5165\u8bc1\u636e\u3002"
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
              \u6279\u51c6\u5e76\u7ee7\u7eed
            </Button>
            <Button
              danger
              onClick={handleDeny}
              disabled={disabled}
              data-testid="approval-deny-button"
            >
              \u62d2\u7edd
            </Button>
          </div>

          {/* Evidence slot is a placeholder at P0 (see file-level TODO). */}
          <section className="owb-approval-drawer__evidence" aria-label="\u56de\u5408\u8bc1\u636e">
            <h3 className="owb-approval-drawer__section-title">\u56de\u5408\u8bc1\u636e</h3>
            <p className="owb-muted">\u8bc1\u636e\u5217\u8868\u5f85 v1 \u5c31\u7eea\uff08turn-evidence.v1 \u6709\u754c\u626b\u63cf + SSE\uff09\u3002</p>
          </section>
        </Space>
      </div>
    </Drawer>
  );
}
