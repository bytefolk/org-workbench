// #33 四态状态机（发起 → 过程态 → 审批(可选) → 终态）+ hire 契约消费映射。
// 消费修订（R3 冻结门禁项①②③，PM 台账 2026-08-26）：
// - 权威词表 = hire-request.v1alpha1（digital-employee #194/#198，merge b3d54bf）；
// - renderer 草稿只携带 HirePositionRequest 字段；envelope 骨架字段
//   workspaceRef / packageRef{name,version,digest} / targetParentId / budget /
//   requestedBy / deadline / envelopeDigest 全部由控制面 POST /hire 组装，
//   renderer 不构造、不扩展任何 envelope 词表；
// - reportTo（草稿侧）→ targetParentId 由控制面解析（null = 企业负责人），
//   identity.reportTo 不存在于骨架（服务端硬拒面由上游 fail-closed 承担）；
// - 审批态：hire 通道上游无 approval 语义（hire-contract.md Consumer boundary），
//   approval 相位仅为四态机保留位，动作集合刻意没有 approve/deny；turn 内审批
//   走 #25 Slice B 的 approval 三事件契约，两线零混用。

import type { HireMcpGrant, HirePositionRequest, NetworkPolicy, PositionBudget } from "@org-workbench/shared";

export interface HireDraft {
  id: string;
  name: string;
  description: string;
  reportTo: string | null;
  mode: "read_only" | "approval_required";
  budget: PositionBudget;
  /** #87: network egress policy. */
  network: NetworkPolicy;
  /**
   * #89: optional MCP grant. Absent means no tools and no `entrypoints.mcp` —
   * the draft carries the grant verbatim; the control plane validates it.
   */
  mcp?: HireMcpGrant;
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
    network: "deny",
    ...presets,
  };
}

export function initialHireFlow(presets?: Partial<HireDraft>): HireFlowState {
  return { phase: "draft", draft: createHireDraft(presets) };
}

/** Draft → POST /hire body; exact shared HirePositionRequest shape, no extra keys. */
export function toHirePositionRequest(draft: HireDraft): HirePositionRequest {
  return {
    positionId: draft.id,
    name: draft.name,
    description: draft.description,
    reportTo: draft.reportTo,
    mode: draft.mode,
    budget: draft.budget,
    network: draft.network,
    ...(draft.mcp ? { mcp: draft.mcp } : {}),
  };
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
