/**
 * #33 创建员工四态抽屉（DS-33-001 §0–§5）：S1 发起 → S2 执行过程态 →
 * S3 审批（保留位）→ S4 结果态。消费 hire-request.v1alpha1 静态契约面：
 * POST /hire 是唯一创建通道；S2 阶段文案由 hire.progress 事件驱动，缺事件
 * 停留上阶段，不编造进度百分比；执行中不可取消（上游静态面无中止语义，
 * DS-33-001 §2 口径）；60s 无任何事件或响应 → S4 失败（hire_timeout，可重试）。
 * S3 审批态：hire 通道上游无 approval 语义，四态机保留该相位但永不触发；
 * turn 内审批卡片由 #25 Slice B 承载，两线零混用。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button as AntButton, Drawer, Input, Select, Steps, message } from "antd";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { Input as OwbInput } from "@fullstack-ai-infra/ui";
import { useT } from "@org-workbench/ui";
import {
  createHireDraft,
  initialHireFlow,
  reduceHireFlow,
  toHirePositionRequest,
} from "./hire-flow";
import type { HireDraft } from "./hire-flow";

// Verbatim mirror of the digital-employee position-id contract
// (packages/shared/position-id.cjs). The ESM wrapper uses node:module's
// createRequire, which cannot enter the renderer bundle, so the renderer
// keeps its own mirror of the same literal; the control plane remains the
// authoritative gate (POST /hire rejects non-conforming ids).
const POSITION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_POSITION_ID_LENGTH = 64;
const isPositionId = (value: string): boolean =>
  value.length <= MAX_POSITION_ID_LENGTH && POSITION_ID_PATTERN.test(value);

const { TextArea } = Input;

/** DS-33-001 §2: 60s without any event or response → S4 failure, never wait forever. */
const HIRE_STALL_TIMEOUT_MS = 60_000;

/** #146：S2 过程态文案仍由 hire.progress 事件驱动，词面走目录。 */
const PHASE_COPY_KEYS: Record<string, string> = {
  validate: "hire.phaseValidate",
  stage: "hire.phaseStage",
  apply: "hire.phaseApply",
};

/** DS-33-001 §4 失败人话文案：错误码原样展示（可复制），另给可读解释。 */
const FAILURE_COPY_KEYS: Record<string, string> = {
  hire_position_exists: "hire.errExists",
  hire_timeout: "hire.errTimeout",
  control_plane_unreachable: "hire.errOffline",
  engine_unavailable: "hire.errCli",
  engine_capability_missing: "hire.errCapability",
};

interface HireDrawerProps {
  open: boolean;
  positions: Array<{ id: string; name: string }>;
  presetReportTo: string | null;
  onClose: () => void;
  /** Called after a trusted terminal success: tree linkage (expand + select). */
  onHired: (positionId: string, name: string) => void;
}

export function HireDrawer({ open, positions, presetReportTo, onClose, onHired }: HireDrawerProps) {
  const t = useT();
  const [flow, dispatch] = useReducer(reduceHireFlow, undefined, () => initialHireFlow());
  const [name, setName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [description, setDescription] = useState("");
  const [reportTo, setReportTo] = useState<string | null>(presetReportTo);
  const [mode, setMode] = useState<HireDraft["mode"]>("approval_required");
  const [taskTokens, setTaskTokens] = useState("");
  const [taskIterations, setTaskIterations] = useState("");
  const [dayTokens, setDayTokens] = useState("");
  const [dayIterations, setDayIterations] = useState("");
  const [phaseCopy, setPhaseCopy] = useState(t("hire.phaseSubmit"));
  const [messageApi, contextHolder] = message.useMessage();
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    setReportTo(presetReportTo);
  }, [open, presetReportTo]);

  const clearTimers = useCallback(() => {
    if (stallTimer.current !== null) {
      clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
    unsubscribe.current?.();
    unsubscribe.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const armStallTimer = useCallback(
    (targetId: string) => {
      if (stallTimer.current !== null) clearTimeout(stallTimer.current);
      stallTimer.current = setTimeout(() => {
        dispatch({ type: "fail", code: "hire_timeout", retryable: true });
      }, HIRE_STALL_TIMEOUT_MS);
      unsubscribe.current?.();
      unsubscribe.current = window.owb.onEvent((event) => {
        const envelope = event as { type?: string; payload?: { positionId?: string; phase?: string } };
        if (envelope.type !== "hire.progress" || envelope.payload?.positionId !== targetId) return;
        const phase = envelope.payload.phase ?? "";
        setPhaseCopy((previous) => PHASE_COPY_KEYS[phase] !== undefined ? t(PHASE_COPY_KEYS[phase]) : previous);
        if (stallTimer.current !== null) {
          clearTimeout(stallTimer.current);
          stallTimer.current = setTimeout(() => {
            dispatch({ type: "fail", code: "hire_timeout", retryable: true });
          }, HIRE_STALL_TIMEOUT_MS);
        }
      });
    },
    [t],
  );

  const idValid = isPositionId(positionId);
  const nameValid = name.trim().length > 0 && name.trim().length <= 24;
  const capsValid = useCallback((value: string, required: boolean) => {
    if (value.trim() === "") return !required;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000_000;
  }, []);
  const budgetValid =
    capsValid(taskTokens, true) && capsValid(dayTokens, true) && capsValid(taskIterations, false) && capsValid(dayIterations, false);
  const descriptionValid = description.trim().length > 0;
  const formValid = nameValid && idValid && descriptionValid && budgetValid;

  const buildDraft = useCallback(
    (): HireDraft =>
      createHireDraft({
        id: positionId,
        name: name.trim(),
        description: description.trim(),
        reportTo: reportTo || null,
        mode,
        budget: {
          perTask: { tokens: Number(taskTokens), ...(taskIterations.trim() ? { iterations: Number(taskIterations) } : {}) },
          perDay: { tokens: Number(dayTokens), ...(dayIterations.trim() ? { iterations: Number(dayIterations) } : {}) },
        },
      }),
    [positionId, name, description, reportTo, mode, taskTokens, taskIterations, dayTokens, dayIterations],
  );

  const submit = useCallback(async () => {
    const draft = buildDraft();
    dispatch({ type: "edit", draft });
    dispatch({ type: "submit" });
    setPhaseCopy(t("hire.phaseSubmit"));
    armStallTimer(draft.id);
    try {
      const response = await window.owb.hire(toHirePositionRequest(draft));
      clearTimers();
      if (response.status === 200 && response.body.status === "hired") {
        dispatch({ type: "succeed", positionId: draft.id });
        messageApi.success(t("hire.joined", { name: draft.name }));
        onHired(draft.id, draft.name);
        onClose();
        dispatch({ type: "reset", draft: createHireDraft({ reportTo: presetReportTo }) });
        setName("");
        setPositionId("");
        setDescription("");
        setTaskTokens("");
        setTaskIterations("");
        setDayTokens("");
        setDayIterations("");
        return;
      }
      const body = response.body as { code?: string; retryable?: boolean };
      dispatch({ type: "fail", code: body.code ?? "hire_failed", retryable: body.retryable ?? false });
    } catch {
      clearTimers();
      dispatch({ type: "fail", code: "control_plane_unreachable", retryable: true });
    }
  }, [armStallTimer, buildDraft, clearTimers, messageApi, onClose, onHired, presetReportTo, t]);

  const retry = useCallback(async () => {
    dispatch({ type: "retry" });
    // Resubmit the unchanged draft immediately (DS-33-001 §4「重试」).
    const draft = flow.phase === "failed" ? flow.draft : buildDraft();
    dispatch({ type: "edit", draft });
    dispatch({ type: "submit" });
    setPhaseCopy(t("hire.phaseSubmit"));
    armStallTimer(draft.id);
    try {
      const response = await window.owb.hire(toHirePositionRequest(draft));
      clearTimers();
      if (response.status === 200 && response.body.status === "hired") {
        dispatch({ type: "succeed", positionId: draft.id });
        messageApi.success(t("hire.joined", { name: draft.name }));
        onHired(draft.id, draft.name);
        onClose();
        return;
      }
      const body = response.body as { code?: string; retryable?: boolean };
      dispatch({ type: "fail", code: body.code ?? "hire_failed", retryable: body.retryable ?? false });
    } catch {
      clearTimers();
      dispatch({ type: "fail", code: "control_plane_unreachable", retryable: true });
    }
  }, [armStallTimer, buildDraft, clearTimers, flow, messageApi, onClose, onHired, t]);

  const stepCurrent = useMemo(() => {
    if (flow.phase === "draft") return 0;
    if (flow.phase === "submitting" || flow.phase === "approval") return 1;
    if (flow.phase === "succeeded") return 2;
    return 1;
  }, [flow.phase]);

  return (
    <Drawer
      title={t("tree.create")}
      width={480}
      open={open}
      onClose={() => {
        if (flow.phase === "submitting" || flow.phase === "approval") return;
        clearTimers();
        onClose();
      }}
      destroyOnHidden
    >
      {contextHolder}
      {(flow.phase === "draft") && (
        <div className="owb-hire-drawer">
          <div className="owb-form-grid">
            <label htmlFor="hire-name">{t("hire.name")}</label>
            <OwbInput id="hire-name" name="hire-name" autoComplete="off" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t("hire.namePh")} />
            <label htmlFor="hire-id">{t("hire.id")}</label>
            <OwbInput id="hire-id" name="hire-id" autoComplete="off" spellCheck={false} value={positionId} onChange={(e) => setPositionId(e.target.value)} placeholder={t("hire.idPh")} />
            {!idValid && positionId !== "" ? <p className="owb-hire-drawer__hint owb-hire-drawer__hint--error">{t("hire.idInvalid")}</p> : null}
            <label htmlFor="hire-desc">{t("hire.desc")}</label>
            <TextArea id="hire-desc" name="hire-desc" value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder={t("hire.descPh")} />
            <label htmlFor="hire-report">{t("hire.reportTo")}</label>
            <Select
              id="hire-report"
              value={reportTo ?? ""}
              onChange={(value: string) => setReportTo(value === "" ? null : value)}
              options={[{ value: "", label: t("hire.ownerRoot") }, ...positions.map((p) => ({ value: p.id, label: t("hire.reportOption", { name: p.name, id: p.id }) }))]}
            />
            <label htmlFor="hire-mode">{t("hire.mode")}</label>
            <Select id="hire-mode" value={mode} onChange={(value: HireDraft["mode"]) => setMode(value)} options={[{ value: "read_only", label: t("hire.modeReadOnly") }, { value: "approval_required", label: t("hire.modeApproval") }]} />
            <label htmlFor="hire-task-tokens">{t("hire.taskTokens")}</label>
            <OwbInput id="hire-task-tokens" name="hire-task-tokens" autoComplete="off" value={taskTokens} inputMode="numeric" onChange={(e) => setTaskTokens(e.target.value)} placeholder={t("hire.positiveInt")} />
            <label htmlFor="hire-task-iters">{t("hire.taskIters")}</label>
            <OwbInput id="hire-task-iters" name="hire-task-iters" autoComplete="off" value={taskIterations} inputMode="numeric" onChange={(e) => setTaskIterations(e.target.value)} placeholder={t("hire.optional")} />
            <label htmlFor="hire-day-tokens">{t("hire.dayTokens")}</label>
            <OwbInput id="hire-day-tokens" name="hire-day-tokens" autoComplete="off" value={dayTokens} inputMode="numeric" onChange={(e) => setDayTokens(e.target.value)} placeholder={t("hire.positiveInt")} />
            <label htmlFor="hire-day-iters">{t("hire.dayIters")}</label>
            <OwbInput id="hire-day-iters" name="hire-day-iters" autoComplete="off" value={dayIterations} inputMode="numeric" onChange={(e) => setDayIterations(e.target.value)} placeholder={t("hire.optional")} />
          </div>
          <p className="owb-hire-drawer__hint">{t("hire.hint")}</p>
          <footer className="owb-modal__footer">
            <AntButton onClick={onClose}>{t("dlg.cancel")}</AntButton>
            <AntButton type="primary" disabled={!formValid} onClick={() => void submit()}>{t("hire.start")}</AntButton>
          </footer>
        </div>
      )}
      {(flow.phase === "submitting" || flow.phase === "approval") && (
        <div className="owb-hire-drawer">
          <Steps current={stepCurrent} items={[{ title: t("hire.stepSubmit") }, { title: t("hire.stepExec") }, { title: t("hire.stepReady") }]} />
          <div className="owb-hire-drawer__running">
            <LoaderCircle aria-hidden="true" className="owb-hire-drawer__spin" size={18} />
            <span aria-live="polite">{phaseCopy}</span>
          </div>
          <footer className="owb-modal__footer">
            <AntButton disabled title={t("hire.noCancelTitle")}>{t("hire.noCancel")}</AntButton>
          </footer>
        </div>
      )}
      {flow.phase === "failed" && (
        <div className="owb-hire-drawer">
          <div className="owb-hire-drawer__failed">
            <XCircle aria-hidden="true" size={22} />
            <p className="owb-hire-drawer__failed-code">{flow.code}</p>
            <p>{t(FAILURE_COPY_KEYS[flow.code] ?? "hire.errDenied")}</p>
          </div>
          <footer className="owb-modal__footer">
            <AntButton onClick={() => dispatch({ type: "retry" })}>{t("hire.editRetry")}</AntButton>
            <AntButton type="primary" disabled={!flow.retryable} onClick={() => void retry()}>{t("hire.retry")}</AntButton>
          </footer>
        </div>
      )}
      {flow.phase === "succeeded" && (
        <div className="owb-hire-drawer">
          <div className="owb-hire-drawer__done">
            <CheckCircle2 aria-hidden="true" size={22} />
            <p>{t("hire.joined", { name: flow.draft.name })}</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}
