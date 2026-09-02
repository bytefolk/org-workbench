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
import { useT } from "@org-workbench/ui";
import {
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
  const t = useT();
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
        title={t("apr.detailTitle")}
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
      title={t("apr.detailTitleCategory", { category: t(`apr.kind.${item.category}`) })}
      destroyOnClose
      data-testid="approval-detail-drawer"
    >
      <div className="owb-approval-drawer" data-approval-id={item.approvalId}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="owb-approval-drawer__meta">
            <Tag color="purple">{t(`apr.kind.${item.category}`)}</Tag>
            {overreach ? <Tag color="red">{t("apr.overreach")}</Tag> : null}
            {item.positionMode ? (
              <Tag color={item.positionMode === "read_only" ? "default" : "purple"}>
                {t("apr.modeTag", { mode: item.positionMode === "read_only" ? t("pos.readOnly") : t("pos.approval") })}
              </Tag>
            ) : null}
          </div>

          <section>
            <h3 className="owb-approval-drawer__section-title">{t("apr.requestingPosition")}</h3>
            <p className="owb-approval-drawer__position">
              <strong>{item.positionName ?? item.positionId}</strong>
              <span className="owb-approval-drawer__pid">{item.positionId}</span>
            </p>
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">{t("apr.actionDescription")}</h3>
            <p className="owb-approval-drawer__description">{item.description}</p>
            {item.target ? (
              <p className="owb-approval-drawer__target">
                {t("apr.targetPrefix")}<code>{item.target}</code>
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="owb-approval-drawer__section-title">{t("apr.deadlineAndId")}</h3>
            <p className="owb-approval-drawer__meta-line">
              {item.expiresAt ? (
                <span>{t("apr.expiresPrefix")}<code>{item.expiresAt}</code></span>
              ) : (
                <span className="owb-muted">{t("apr.noExpiry")}</span>
              )}
              <span>{t("apr.idPrefix")}<code>{item.approvalId}</code></span>
            </p>
          </section>

          {decided ? (
            <Alert
              type={item.decision.kind === "granted" ? "success" : item.decision.kind === "denied" ? "error" : "info"}
              message={
                item.decision.kind === "granted"
                  ? t("apr.alertGranted")
                  : item.decision.kind === "denied"
                    ? t("apr.alertDenied")
                    : t("apr.alertExpired")
              }
              description={
                item.decision.kind === "denied" && item.decision.reason
                  ? t("apr.reasonPrefix", { reason: item.decision.reason })
                  : undefined
              }
              showIcon
            />
          ) : (
            <section>
              <h3 className="owb-approval-drawer__section-title">{t("apr.reasonOptional")}</h3>
              <Input.TextArea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("apr.reasonPh")}
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
              {t("apr.grant")}
            </Button>
            <Button
              danger
              onClick={handleDeny}
              disabled={disabled}
              data-testid="approval-deny-button"
            >
              {t("apr.deny")}
            </Button>
          </div>

          {/* Evidence slot is a placeholder at P0 (see file-level TODO). */}
          <section className="owb-approval-drawer__evidence" aria-label={t("apr.evidence")}>
            <h3 className="owb-approval-drawer__section-title">{t("apr.evidence")}</h3>
            <p className="owb-muted">{t("apr.evidencePending")}</p>
          </section>
        </Space>
      </div>
    </Drawer>
  );
}
