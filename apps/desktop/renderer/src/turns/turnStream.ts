import type { TurnEngine } from "./types";

/**
 * Renderer-local projection of the frozen turn.* SSE vocabulary
 * (docs/api-contract-v0.md §2.10). The renderer never reconstructs
 * turn-record.v1: streaming text is a provisional overlay, and every
 * terminal event hands authority back to the persisted history reload.
 */

export interface PendingTurnRequestState {
  positionId: string;
  engine: TurnEngine;
  input: string;
  /** Bound on the first engine event observed for the in-flight POST. */
  runId: string | null;
}

export interface LiveRunState {
  positionId: string;
  engine: TurnEngine;
  input: string;
  text: string;
  startedAt: string;
  /** Latest engine-reported usage; feeds the compact status line only. */
  totalTokens: number | null;
}

export interface TurnStreamState {
  /** Last processed envelope seq; replays at or below it are idempotent no-ops. */
  seq: number;
  pending: PendingTurnRequestState | null;
  runs: Record<string, LiveRunState>;
}

export const EMPTY_TURN_STREAM: TurnStreamState = { seq: 0, pending: null, runs: {} };

export interface TurnStreamEnvelope {
  seq?: unknown;
  type?: unknown;
  at?: unknown;
  payload?: unknown;
}

const LIVE_RUNS_CAP = 32;

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function evictIfOverCap(runs: Record<string, LiveRunState>): Record<string, LiveRunState> {
  const entries = Object.entries(runs);
  if (entries.length <= LIVE_RUNS_CAP) return runs;
  entries.sort((a, b) => a[1].startedAt.localeCompare(b[1].startedAt));
  return Object.fromEntries(entries.slice(entries.length - LIVE_RUNS_CAP));
}

export function beginPendingTurn(
  state: TurnStreamState,
  request: { positionId: string; engine: TurnEngine; input: string },
): TurnStreamState {
  return { ...state, pending: { ...request, runId: null } };
}

/** The in-flight POST failed before any engine attribution; drop the pending marker only. */
export function cancelPendingTurn(state: TurnStreamState): TurnStreamState {
  return { ...state, pending: null };
}

/**
 * The POST returned, so the server-side record is terminal and the history
 * reload is authoritative. Drop the pending marker and any live buffer that
 * the terminal already superseded.
 */
export function settlePendingTurn(
  state: TurnStreamState,
  outcome: { runId: string | null; positionId: string },
): TurnStreamState {
  const runs: Record<string, LiveRunState> = {};
  for (const [runId, run] of Object.entries(state.runs)) {
    const superseded = outcome.runId !== null
      ? runId === outcome.runId
      : run.positionId === outcome.positionId;
    if (!superseded) runs[runId] = run;
  }
  return { ...state, pending: null, runs };
}

export function resetStreamSeq(state: TurnStreamState): TurnStreamState {
  return { ...state, seq: 0 };
}

export function applyTurnEvent(
  state: TurnStreamState,
  envelope: TurnStreamEnvelope,
): TurnStreamState {
  const seq = typeof envelope.seq === "number" && Number.isFinite(envelope.seq) ? envelope.seq : null;
  if (seq !== null && seq <= state.seq) return state;
  const nextSeq = seq ?? state.seq;
  const payload = payloadRecord(envelope.payload);
  const runId = stringField(payload, "runId");

  switch (envelope.type) {
    case "turn.started":
    case "turn.model.delta": {
      if (runId === null) return { ...state, seq: nextSeq };
      const existing = state.runs[runId];
      const delta = envelope.type === "turn.model.delta" ? (stringField(payload, "text") ?? "") : "";
      if (existing) {
        return {
          ...state,
          seq: nextSeq,
          runs: { ...state.runs, [runId]: { ...existing, text: existing.text + delta } },
        };
      }
      const pending = state.pending;
      // A run we cannot attribute to our in-flight POST is left to the
      // authoritative history reload; the renderer never guesses a position.
      if (pending === null || (pending.runId !== null && pending.runId !== runId)) {
        return { ...state, seq: nextSeq };
      }
      const startedAt = stringField(payload, "timestamp") ?? new Date().toISOString();
      return {
        ...state,
        seq: nextSeq,
        pending: { ...pending, runId },
        runs: evictIfOverCap({
          ...state.runs,
          [runId]: {
            positionId: pending.positionId,
            engine: pending.engine,
            input: pending.input,
            text: delta,
            startedAt,
            totalTokens: null,
          },
        }),
      };
    }
    case "turn.usage": {
      if (runId === null) return { ...state, seq: nextSeq };
      const existing = state.runs[runId];
      if (existing === undefined) return { ...state, seq: nextSeq };
      const rawTotal = payload?.totalTokens;
      const totalTokens = typeof rawTotal === "number" && Number.isFinite(rawTotal) ? rawTotal : existing.totalTokens;
      return {
        ...state,
        seq: nextSeq,
        runs: { ...state.runs, [runId]: { ...existing, totalTokens } },
      };
    }
    case "turn.completed":
    case "turn.failed": {
      if (runId === null || state.runs[runId] === undefined) return { ...state, seq: nextSeq };
      const runs = { ...state.runs };
      delete runs[runId];
      return { ...state, seq: nextSeq, runs };
    }
    case "turn.indeterminate": {
      // No runId is carried; scope the cleanup to the reported position, or to
      // the run bound to the in-flight POST when the position is absent.
      const positionId = stringField(payload, "positionId");
      const pendingRunId = state.pending?.runId ?? null;
      const runs: Record<string, LiveRunState> = {};
      for (const [runId, run] of Object.entries(state.runs)) {
        const scoped = positionId !== null
          ? run.positionId === positionId
          : runId === pendingRunId;
        if (!scoped) runs[runId] = run;
      }
      return { ...state, seq: nextSeq, runs };
    }
    default:
      return { ...state, seq: nextSeq };
  }
}
