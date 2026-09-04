import { zhText } from "@org-workbench/ui";
import type {
  TurnHistory as ApiTurnHistory,
  TurnRecord as ApiTurnRecord,
} from "@org-workbench/shared";
import type { TurnApprovalRequest, TurnRecord } from "./types";

/** #146：展示兜底文案走目录；裸调用（测试/无 Provider）回退 zh 词。 */
function renderOutput(output: unknown, unrenderable: string): string | undefined {
  if (output === undefined) return undefined;
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return unrenderable;
  }
}

/** A turn settled as engine.approval_required awaits an operator verdict;
 * project the requesting event so the renderer can render the card. */
function approvalRequest(record: ApiTurnRecord): TurnApprovalRequest | undefined {
  if (record.status !== "failed" || record.error?.code !== "engine.approval_required") {
    return undefined;
  }
  for (let index = record.events.length - 1; index >= 0; index -= 1) {
    const event = record.events[index];
    if (event === undefined) continue;
    if (event.type === "approval.requested") {
      return {
        approvalId: event.approvalId,
        kind: event.action.kind,
        description: event.action.description,
        ...(event.action.target !== undefined ? { target: event.action.target } : {}),
        ...(event.expiresAt !== undefined ? { expiresAt: event.expiresAt } : {}),
      };
    }
  }
  return undefined;
}

/**
 * Explicit presentation adapter. The renderer never persists or reconstructs
 * turn-record.v1; it only gives the server-owned record a display shape.
 */
export function adaptTurnRecord(
  record: ApiTurnRecord,
  positionName: string,
  unrenderableOutput: string = zhText("turn.unrenderableOutput"),
): TurnRecord {
  const pendingApproval = approvalRequest(record);
  return {
    id: record.turnId,
    positionId: record.positionId,
    positionName,
    engine: record.engine,
    input: record.input,
    status: record.status,
    createdAt: record.createdAt,
    ...(record.status !== "running" ? { completedAt: record.updatedAt } : {}),
    ...(record.output !== undefined ? { output: renderOutput(record.output, unrenderableOutput) } : {}),
    ...(record.runId !== undefined ? { runId: record.runId } : {}),
    ...(record.error !== undefined
      ? { error: `${record.error.code}: ${record.error.message}` }
      : {}),
    ...(pendingApproval !== undefined ? { approvalRequest: pendingApproval } : {}),
    envelopeDigest: record.envelopeDigest,
  };
}

export function adaptTurnHistory(
  history: ApiTurnHistory,
  positionName: string,
  unrenderableOutput?: string,
): TurnRecord[] {
  return history.turns.map((record) => adaptTurnRecord(record, positionName, unrenderableOutput));
}
