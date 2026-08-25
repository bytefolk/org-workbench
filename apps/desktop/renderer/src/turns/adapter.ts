import type {
  TurnHistory as ApiTurnHistory,
  TurnRecord as ApiTurnRecord,
} from "@org-workbench/shared";
import type { TurnRecord } from "./types";

function renderOutput(output: unknown): string | undefined {
  if (output === undefined) return undefined;
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return "[无法显示的结构化输出]";
  }
}

/**
 * Explicit presentation adapter. The renderer never persists or reconstructs
 * turn-record.v1; it only gives the server-owned record a display shape.
 */
export function adaptTurnRecord(record: ApiTurnRecord, positionName: string): TurnRecord {
  return {
    id: record.turnId,
    positionId: record.positionId,
    positionName,
    engine: record.engine,
    input: record.input,
    status: record.status,
    createdAt: record.createdAt,
    ...(record.status !== "running" ? { completedAt: record.updatedAt } : {}),
    ...(record.output !== undefined ? { output: renderOutput(record.output) } : {}),
    ...(record.runId !== undefined ? { runId: record.runId } : {}),
    ...(record.error !== undefined
      ? { error: `${record.error.code}: ${record.error.message}` }
      : {}),
    envelopeDigest: record.envelopeDigest,
  };
}

export function adaptTurnHistory(
  history: ApiTurnHistory,
  positionName: string,
): TurnRecord[] {
  return history.turns.map((record) => adaptTurnRecord(record, positionName));
}
