import { createRequire } from "node:module";
import type { TurnPendingApproval } from "./turns.js";

export type PendingApprovalValidation =
  | { ok: true; value: TurnPendingApproval }
  | { ok: false; message: string };

interface PendingApprovalContract {
  MAX_APPROVAL_ID_LENGTH: number;
  MAX_APPROVAL_REASON_BYTES: number;
  validatePendingApproval(value: unknown): PendingApprovalValidation;
}

const require = createRequire(import.meta.url);
const contract = require("../pending-approval.cjs") as PendingApprovalContract;

/** Upstream #193 envelope first-gate bounds, mirrored verbatim. */
export const MAX_APPROVAL_ID_LENGTH = contract.MAX_APPROVAL_ID_LENGTH;
export const MAX_APPROVAL_REASON_BYTES = contract.MAX_APPROVAL_REASON_BYTES;
/** Single-source fail-closed validator shared by the HTTP and IPC boundaries. */
export const validatePendingApproval = contract.validatePendingApproval;
