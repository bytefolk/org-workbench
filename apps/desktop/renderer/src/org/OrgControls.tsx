import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@fullstack-ai-infra/ui";
import type { OrgBackupEntry } from "@org-workbench/shared";
import { ArchiveRestore, Trash2 } from "lucide-react";

export function DismissPositionDialog({
  positionName,
  positionId,
  descendantCount,
  busy,
  onDismiss,
}: {
  positionName: string;
  positionId: string;
  descendantCount: number;
  busy: boolean;
  onDismiss: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 触发键克制：平时是 hairline 幽灵按钮，hover/focus 才转 danger。
          裁撤是低频且不可逆的操作，不该用实心红长期占据视觉重心；真正的
          警示留给二次确认弹窗。 */}
      <button
        type="button"
        className="owb-dismiss"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        <Trash2 aria-hidden="true" size={13} />
        裁撤
      </button>
      <Modal
        open={open}
        title={`确认裁撤 ${positionName}`}
        description={`岗位 ${positionId}${descendantCount > 0 ? ` 及其 ${descendantCount} 个下属岗位` : ""}将移出组织树，完整目录保留在本地 backup，可从恢复区手动恢复。不会自动回滚。`}
        onOpenChange={setOpen}
      >
        <footer className="owb-modal__footer">
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
          <Button variant="danger" disabled={busy} onClick={() => void onDismiss().then((ok) => ok && setOpen(false))}>确认裁撤并留痕</Button>
        </footer>
      </Modal>
    </>
  );
}

export function BackupTray({
  backups,
  busy,
  onRestore,
}: {
  backups: OrgBackupEntry[];
  busy: boolean;
  onRestore: (backupId: string) => Promise<boolean>;
}) {
  return (
    <section className="owb-backups" aria-label="岗位恢复区">
      <header><ArchiveRestore aria-hidden="true" size={13} /><span>恢复区</span><strong>{backups.length}</strong></header>
      {backups.length === 0 ? <p>暂无可恢复岗位</p> : backups.map((backup) => (
        <div className="owb-backups__item" key={backup.backupId}>
          <span><strong>{backup.name}</strong><small>{backup.positionId} · 原汇报 {backup.reportTo ?? "企业根"}</small></span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRestore(backup.backupId)}>一键恢复</Button>
        </div>
      ))}
    </section>
  );
}

function Modal({
  open,
  title,
  description,
  className,
  onOpenChange,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  className?: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;
  return (
    <div className="owb-modal" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onOpenChange(false);
    }}>
      <section
        className={["owb-modal__panel", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="owb-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button type="button" className="owb-modal__close" aria-label="关闭弹窗" onClick={() => onOpenChange(false)}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
