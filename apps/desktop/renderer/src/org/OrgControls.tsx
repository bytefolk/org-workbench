import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input } from "@fullstack-ai-infra/ui";
import type { AddPositionChange, OrgBackupEntry } from "@org-workbench/shared";
import { ArchiveRestore, Plus, Trash2 } from "lucide-react";

type PositionDraft = AddPositionChange["position"];

export function HirePositionDialog({
  positions,
  defaultManager,
  busy,
  onHire,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: {
  positions: Array<{ id: string; name: string }>;
  defaultManager: string | null;
  busy: boolean;
  onHire: (position: PositionDraft) => Promise<boolean>;
  /** Controlled open state (#32 AC-004 tree-node "+" entry); omit for self-triggered mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Suppress the trigger button (controlled entries bring their own trigger). */
  hideTrigger?: boolean;
}) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reportTo, setReportTo] = useState(defaultManager ?? "");
  const [mode, setMode] = useState<"read_only" | "approval_required">("approval_required");
  const [taskTokens, setTaskTokens] = useState("");
  const [taskIterations, setTaskIterations] = useState("");
  const [dayTokens, setDayTokens] = useState("");
  const [dayIterations, setDayIterations] = useState("");

  // Both creation entries (#32 AC-004) preset the reporting line at open time.
  useEffect(() => {
    if (open) setReportTo(defaultManager ?? "");
  }, [open, defaultManager]);

  const valid = useMemo(() =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64 &&
    name.trim().length > 0 && description.trim().length > 0 &&
    validCap(taskTokens, true) && validCap(taskIterations, false) &&
    validCap(dayTokens, true) && validCap(dayIterations, false),
  [dayIterations, dayTokens, description, id, name, taskIterations, taskTokens]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const ok = await onHire({
      id,
      name: name.trim(),
      description: description.trim(),
      reportTo: reportTo || null,
      mode,
      memoryScope: "/",
      toolAllow: [],
      toolDeny: [],
      budget: {
        perTask: caps(taskTokens, taskIterations),
        perDay: caps(dayTokens, dayIterations),
      },
    });
    if (ok) {
      setOpen(false);
      setId(""); setName(""); setDescription("");
      setTaskTokens(""); setTaskIterations(""); setDayTokens(""); setDayIterations("");
    }
  };

  return (
    <>
      {!hideTrigger ? (
        <Button size="sm" onClick={() => setOpen(true)} disabled={busy}>
          <Plus aria-hidden="true" size={14} /> 招聘岗位
        </Button>
      ) : null}
      <Modal
        open={open}
        title="招聘岗位并声明预算"
        description="预算单位仅为 tokens / iterations；两个周期的 token 上限都配齐后才能提交。当前为直连应用（beta）过渡入口，hire 契约面（digital-employee #194）合入后切换。"
        className="owb-org-dialog"
        onOpenChange={setOpen}
      >
        <form onSubmit={(event) => void submit(event)}>
          <div className="owb-form-grid">
            <label>岗位 ID<Input aria-label="岗位 ID" value={id} onChange={(event) => setId(event.target.value)} placeholder="docs-writer" invalid={id.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)} /></label>
            <label>岗位名称<Input aria-label="岗位名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="文档负责人" /></label>
            <label className="owb-form-grid__wide">职责描述<Input aria-label="职责描述" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="维护公开文档与发布说明" /></label>
            <label>汇报对象<select aria-label="汇报对象" value={reportTo} onChange={(event) => setReportTo(event.target.value)}><option value="">企业根</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.name} · {position.id}</option>)}</select></label>
            <label>权限模式<select aria-label="权限模式" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="approval_required">需批准</option><option value="read_only">只读</option></select></label>
          </div>
          <fieldset className="owb-budget-fieldset">
            <legend>预算声明</legend>
            <div className="owb-form-grid">
              <label>单任务 tokens<Input aria-label="单任务 tokens" inputMode="numeric" value={taskTokens} onChange={(event) => setTaskTokens(event.target.value)} /></label>
              <label>单任务 iterations（可选）<Input aria-label="单任务 iterations" inputMode="numeric" value={taskIterations} onChange={(event) => setTaskIterations(event.target.value)} /></label>
              <label>单日 tokens<Input aria-label="单日 tokens" inputMode="numeric" value={dayTokens} onChange={(event) => setDayTokens(event.target.value)} /></label>
              <label>单日 iterations（可选）<Input aria-label="单日 iterations" inputMode="numeric" value={dayIterations} onChange={(event) => setDayIterations(event.target.value)} /></label>
            </div>
          </fieldset>
          <footer className="owb-modal__footer">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? "应用中…" : "确认招聘"}</Button>
          </footer>
        </form>
      </Modal>
    </>
  );
}

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
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} disabled={busy}>
        <Trash2 aria-hidden="true" size={14} /> 裁撤
      </Button>
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

function validCap(value: string, required: boolean): boolean {
  if (value.trim() === "") return !required;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000_000;
}

function caps(tokens: string, iterations: string): { tokens: number; iterations?: number } {
  return {
    tokens: Number(tokens),
    ...(iterations.trim() ? { iterations: Number(iterations) } : {}),
  };
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
