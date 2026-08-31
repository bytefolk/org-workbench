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

const PHASE_COPY: Record<string, string> = {
  validate: "正在校验 hire-request.v1alpha1 契约…",
  stage: "正在接入组织…",
  apply: "正在由引擎落树…",
};

/** DS-33-001 §4 失败人话文案：错误码原样展示（可复制），另给可读解释。 */
const FAILURE_COPY: Record<string, string> = {
  hire_position_exists: "该岗位 ID 已存在，换一个 ID 或修改后重试。",
  hire_timeout: "60 秒内未收到任何进展事件，已按超时失败；可重试。",
  control_plane_unreachable: "控制面当前不可达，未产生任何效果；可重试。",
  engine_unavailable: "digital-employee CLI 不可用，检查安装与路径配置后可重试。",
  engine_capability_missing: "当前 CLI 构建缺少 hire 契约面（需 #194/#198），升级后重试。",
};

function failureCopy(code: string): string {
  return FAILURE_COPY[code] ?? "创建被拒绝；hire 契约面未产生任何效果，已填内容保留。";
}

interface HireDrawerProps {
  open: boolean;
  positions: Array<{ id: string; name: string }>;
  presetReportTo: string | null;
  onClose: () => void;
  /** Called after a trusted terminal success: tree linkage (expand + select). */
  onHired: (positionId: string, name: string) => void;
}

export function HireDrawer({ open, positions, presetReportTo, onClose, onHired }: HireDrawerProps) {
  const [flow, dispatch] = useReducer(reduceHireFlow, undefined, () => initialHireFlow());
  const [name, setName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [description, setDescription] = useState("");
  const [reportTo, setReportTo] = useState<string | null>(presetReportTo);
  const [mode, setMode] = useState<HireDraft["mode"]>("approval_required");
  const [network, setNetwork] = useState<HireDraft["network"]>("deny");
  const [taskTokens, setTaskTokens] = useState("");
  const [taskIterations, setTaskIterations] = useState("");
  const [dayTokens, setDayTokens] = useState("");
  const [dayIterations, setDayIterations] = useState("");
  const [phaseCopy, setPhaseCopy] = useState("正在提交…");
  const [messageApi, contextHolder] = message.useMessage();
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  const resetCreationState = useCallback(() => {
    const fresh = createHireDraft({ reportTo: presetReportTo });
    dispatch({ type: "reset", draft: fresh });
    setName("");
    setPositionId("");
    setDescription("");
    setReportTo(fresh.reportTo);
    setMode(fresh.mode);
    setNetwork(fresh.network);
    setTaskTokens("");
    setTaskIterations("");
    setDayTokens("");
    setDayIterations("");
    setPhaseCopy("正在提交…");
  }, [presetReportTo]);

  useEffect(() => {
    if (!open) return;
    resetCreationState();
  }, [open, resetCreationState]);

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
        setPhaseCopy((previous) => PHASE_COPY[phase] ?? previous);
        if (stallTimer.current !== null) {
          clearTimeout(stallTimer.current);
          stallTimer.current = setTimeout(() => {
            dispatch({ type: "fail", code: "hire_timeout", retryable: true });
          }, HIRE_STALL_TIMEOUT_MS);
        }
      });
    },
    [],
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
        network,
      }),
    [positionId, name, description, reportTo, mode, taskTokens, taskIterations, dayTokens, dayIterations, network],
  );

  const completeHire = useCallback((draft: HireDraft) => {
    dispatch({ type: "succeed", positionId: draft.id });
    messageApi.success(`${draft.name} 已加入团队`);
    onHired(draft.id, draft.name);
    resetCreationState();
    onClose();
  }, [messageApi, onClose, onHired, resetCreationState]);

  const submit = useCallback(async () => {
    const draft = buildDraft();
    dispatch({ type: "edit", draft });
    dispatch({ type: "submit" });
    setPhaseCopy("正在提交…");
    armStallTimer(draft.id);
    try {
      const response = await window.owb.hire(toHirePositionRequest(draft));
      clearTimers();
      if (response.status === 200 && response.body.status === "hired") {
        completeHire(draft);
        return;
      }
      const body = response.body as { code?: string; retryable?: boolean };
      dispatch({ type: "fail", code: body.code ?? "hire_failed", retryable: body.retryable ?? false });
    } catch {
      clearTimers();
      dispatch({ type: "fail", code: "control_plane_unreachable", retryable: true });
    }
  }, [armStallTimer, buildDraft, clearTimers, completeHire]);

  const retry = useCallback(async () => {
    dispatch({ type: "retry" });
    // Resubmit the unchanged draft immediately (DS-33-001 §4「重试」).
    const draft = flow.phase === "failed" ? flow.draft : buildDraft();
    dispatch({ type: "edit", draft });
    dispatch({ type: "submit" });
    setPhaseCopy("正在提交…");
    armStallTimer(draft.id);
    try {
      const response = await window.owb.hire(toHirePositionRequest(draft));
      clearTimers();
      if (response.status === 200 && response.body.status === "hired") {
        completeHire(draft);
        return;
      }
      const body = response.body as { code?: string; retryable?: boolean };
      dispatch({ type: "fail", code: body.code ?? "hire_failed", retryable: body.retryable ?? false });
    } catch {
      clearTimers();
      dispatch({ type: "fail", code: "control_plane_unreachable", retryable: true });
    }
  }, [armStallTimer, buildDraft, clearTimers, completeHire, flow]);

  const close = useCallback(() => {
    if (flow.phase === "submitting" || flow.phase === "approval") return;
    clearTimers();
    resetCreationState();
    onClose();
  }, [clearTimers, flow.phase, onClose, resetCreationState]);

  const stepCurrent = useMemo(() => {
    if (flow.phase === "draft") return 0;
    if (flow.phase === "submitting" || flow.phase === "approval") return 1;
    if (flow.phase === "succeeded") return 2;
    return 1;
  }, [flow.phase]);

  return (
    <Drawer
      title="创建员工"
      width={480}
      open={open}
      onClose={close}
      destroyOnHidden
    >
      {contextHolder}
      {(flow.phase === "draft") && (
        <div className="owb-hire-drawer">
          <div className="owb-form-grid">
            <label>姓名*</label>
            <OwbInput value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="员工姓名（≤24 字）" />
            <label>岗位 ID*</label>
            <OwbInput value={positionId} onChange={(e) => setPositionId(e.target.value)} placeholder="小写字母、数字与连字符，≤64 位" />
            {!idValid && positionId !== "" ? <p className="owb-hire-drawer__hint owb-hire-drawer__hint--error">岗位 ID 仅允许小写字母、数字与连字符</p> : null}
            <label>职责描述*</label>
            <TextArea value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="≤500 字" />
            <label>上级</label>
            <Select
              value={reportTo ?? ""}
              onChange={(value: string) => setReportTo(value === "" ? null : value)}
              options={[{ value: "", label: "企业负责人（根）" }, ...positions.map((p) => ({ value: p.id, label: `${p.name}（${p.id}）` }))]}
            />
            <label>运行模式</label>
            <Select aria-label="运行模式" value={mode} onChange={(value: HireDraft["mode"]) => setMode(value)} options={[{ value: "read_only", label: "只读（read_only）" }, { value: "approval_required", label: "需审批（approval_required）" }]} />
            <label>网络访问</label>
            <Select aria-label="网络访问" value={network} disabled options={[{ value: "deny", label: "拒绝网络（deny）" }]} />
            <p className="owb-hire-drawer__hint">当前 org apply → turn → 内置 Host 链路仅支持 deny；网络授权尚未开放。</p>
            <label>每任务 token 上限*</label>
            <OwbInput value={taskTokens} inputMode="numeric" onChange={(e) => setTaskTokens(e.target.value)} placeholder="正整数" />
            <label>每任务迭代上限</label>
            <OwbInput value={taskIterations} inputMode="numeric" onChange={(e) => setTaskIterations(e.target.value)} placeholder="选填" />
            <label>每日 token 上限*</label>
            <OwbInput value={dayTokens} inputMode="numeric" onChange={(e) => setDayTokens(e.target.value)} placeholder="正整数" />
            <label>每日迭代上限</label>
            <OwbInput value={dayIterations} inputMode="numeric" onChange={(e) => setDayIterations(e.target.value)} placeholder="选填" />
          </div>
          <p className="owb-hire-drawer__hint">创建将由系统执行，可能需要几秒到一分钟。</p>
          <footer className="owb-modal__footer">
            <AntButton onClick={close}>取消</AntButton>
            <AntButton type="primary" disabled={!formValid} onClick={() => void submit()}>开始创建</AntButton>
          </footer>
        </div>
      )}
      {(flow.phase === "submitting" || flow.phase === "approval") && (
        <div className="owb-hire-drawer">
          <Steps current={stepCurrent} items={[{ title: "提交" }, { title: "系统执行" }, { title: "就绪" }]} />
          <div className="owb-hire-drawer__running">
            <LoaderCircle aria-hidden="true" className="owb-hire-drawer__spin" size={18} />
            <span aria-live="polite">{phaseCopy}</span>
          </div>
          <footer className="owb-modal__footer">
            <AntButton disabled title="hire 静态面无中止语义">执行中不可取消</AntButton>
          </footer>
        </div>
      )}
      {flow.phase === "failed" && (
        <div className="owb-hire-drawer">
          <div className="owb-hire-drawer__failed">
            <XCircle aria-hidden="true" size={22} />
            <p className="owb-hire-drawer__failed-code">{flow.code}</p>
            <p>{failureCopy(flow.code)}</p>
          </div>
          <footer className="owb-modal__footer">
            <AntButton onClick={() => dispatch({ type: "retry" })}>修改后重试</AntButton>
            <AntButton type="primary" disabled={!flow.retryable} onClick={() => void retry()}>重试</AntButton>
          </footer>
        </div>
      )}
      {flow.phase === "succeeded" && (
        <div className="owb-hire-drawer">
          <div className="owb-hire-drawer__done">
            <CheckCircle2 aria-hidden="true" size={22} />
            <p>{flow.draft.name} 已加入团队</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}
