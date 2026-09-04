/** The verdict travels in the envelope's pendingApproval; this is the
 * operator-visible resume-turn input, so granted and denied must not share
 * one "continue" sentence.
 *
 * #146: this text becomes turn-record input (data layer — turn record
 * content never goes through the locale catalogs), so it stays fixed
 * regardless of UI locale; the escapes mark it as deliberately non-UI copy. */
export function approvalResumeInput(decision: "granted" | "denied", reason?: string): string {
  if (decision === "granted") return "[\u5ba1\u6279\u88c1\u51b3] \u8bf7\u7ee7\u7eed\u6267\u884c\u4e0a\u4e00\u56de\u5408\u6682\u505c\u7684\u52a8\u4f5c";
  return reason !== undefined
    ? `[\u5ba1\u6279\u88c1\u51b3] \u5df2\u62d2\u7edd\uff1a${reason}`
    : "[\u5ba1\u6279\u88c1\u51b3] \u5df2\u62d2\u7edd\u4e0a\u4e00\u56de\u5408\u6682\u505c\u7684\u52a8\u4f5c";
}
