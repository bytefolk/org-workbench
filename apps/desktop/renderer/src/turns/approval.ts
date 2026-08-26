/** The verdict travels in the envelope's pendingApproval; this is the
 * operator-visible resume-turn input, so granted and denied must not share
 * one "continue" sentence. */
export function approvalResumeInput(decision: "granted" | "denied", reason?: string): string {
  if (decision === "granted") return "[审批裁决] 请继续执行上一回合暂停的动作";
  return reason !== undefined
    ? `[审批裁决] 已拒绝：${reason}`
    : "[审批裁决] 已拒绝上一回合暂停的动作";
}
