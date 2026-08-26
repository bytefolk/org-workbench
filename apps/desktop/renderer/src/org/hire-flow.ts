// #33 四态状态机本地态骨架（备工，不触契约）：①draft → ②submitting → ③approval(可选) → ④终态。
// 无 IPC / server / 引擎接线；spawn/hire 执行通道等 digital-employee #194 契约落地后再接。

export interface HireDraft {
  id: string;
  name: string;
  description: string;
  reportTo: string | null;
  mode: "read_only" | "approval_required";
  budget: {
    perTask: { tokens: number; iterations?: number };
    perDay: { tokens: number; iterations?: number };
  };
}

export type HireFlowState =
  | { phase: "draft"; draft: HireDraft }
  | { phase: "submitting"; draft: HireDraft }
  | { phase: "approval"; draft: HireDraft; approvalRef: string | null }
  | { phase: "succeeded"; draft: HireDraft; positionId: string }
  | { phase: "failed"; draft: HireDraft; code: string; retryable: boolean };

export type HireFlowAction =
  | { type: "edit"; draft: HireDraft }
  | { type: "submit" }
  | { type: "approval_required"; approvalRef: string | null }
  | { type: "succeed"; positionId: string }
  | { type: "fail"; code: string; retryable: boolean }
  | { type: "retry" }
  | { type: "reset"; draft: HireDraft };

export function createHireDraft(presets?: Partial<HireDraft>): HireDraft {
  return {
    id: "",
    name: "",
    description: "",
    reportTo: null,
    mode: "approval_required",
    budget: {
      perTask: { tokens: 0 },
      perDay: { tokens: 0 },
    },
    ...presets,
  };
}

export function initialHireFlow(presets?: Partial<HireDraft>): HireFlowState {
  return { phase: "draft", draft: createHireDraft(presets) };
}

export function reduceHireFlow(state: HireFlowState, action: HireFlowAction): HireFlowState {
  switch (action.type) {
    case "edit":
      return state.phase === "draft" ? { phase: "draft", draft: action.draft } : state;
    case "submit":
      return state.phase === "draft" ? { phase: "submitting", draft: state.draft } : state;
    case "approval_required":
      return state.phase === "submitting"
        ? { phase: "approval", draft: state.draft, approvalRef: action.approvalRef }
        : state;
    case "succeed":
      return state.phase === "submitting" || state.phase === "approval"
        ? { phase: "succeeded", draft: state.draft, positionId: action.positionId }
        : state;
    case "fail":
      return state.phase === "submitting" || state.phase === "approval"
        ? { phase: "failed", draft: state.draft, code: action.code, retryable: action.retryable }
        : state;
    case "retry":
      // 失败可恢复：保留表单草稿回到发起态，一键重试（AC-004 后半）。
      return state.phase === "failed" ? { phase: "draft", draft: state.draft } : state;
    case "reset":
      return { phase: "draft", draft: action.draft };
  }
}

// 审批态只展示不回传：action 集合刻意没有 approve/deny，等 #193 pendingApproval verdict 合入后再加。
