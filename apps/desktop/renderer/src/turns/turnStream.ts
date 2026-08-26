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
  /** Group conversation this run belongs to (#52); absent for 1:1 turns. */
  groupRef?: string;
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

/**
 * Group spawn (#52): the 202 response pre-assigns each member's turnId, so the
 * run is adopted here — group turns bypass the single-pending attribution.
 */
export function beginGroupRun(
  state: TurnStreamState,
  spawn: {
    groupRef: string;
    turnId: string;
    positionId: string;
    engine: TurnEngine;
    input: string;
  },
): TurnStreamState {
  if (state.runs[spawn.turnId] !== undefined) return state;
  return {
    ...state,
    runs: evictIfOverCap({
      ...state.runs,
      [spawn.turnId]: {
        positionId: spawn.positionId,
        engine: spawn.engine,
        input: spawn.input,
        text: "",
        startedAt: new Date().toISOString(),
        totalTokens: null,
        groupRef: spawn.groupRef,
      },
    }),
  };
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
      if (stringField(payload, "groupRef") !== null) {
        // Group runs (#52) are seeded by beginGroupRun under the pre-assigned
        // turnId; the first engine event re-keys the buffer under the engine
        // runId so delta/usage/completed all resolve through the normal path.
        const seedId = stringField(payload, "turnId");
        const seeded = seedId !== null ? state.runs[seedId] : undefined;
        if (seeded === undefined || runId === null) return { ...state, seq: nextSeq };
        const runs = { ...state.runs };
        if (seedId !== null && seedId !== runId) delete runs[seedId];
        return {
          ...state,
          seq: nextSeq,
          runs: evictIfOverCap({
            ...runs,
            [runId]: { ...seeded, text: seeded.text + delta },
          }),
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
      // No runId is carried. 1:1 cleanup stays position-scoped (the run buffer
      // is keyed by the engine runId). Group spawn failures (#52) carry
      // groupRef + the pre-assigned turnId (seed key) or match the re-keyed
      // buffer by groupRef+positionId.
      const indeterminateTurnId = stringField(payload, "turnId");
      const indeterminateGroupRef = stringField(payload, "groupRef");
      const positionId = stringField(payload, "positionId");
      const pendingRunId = state.pending?.runId ?? null;
      const runs: Record<string, LiveRunState> = {};
      for (const [runId, run] of Object.entries(state.runs)) {
        const scoped = indeterminateGroupRef !== null && indeterminateTurnId !== null
          ? runId === indeterminateTurnId ||
            (positionId !== null &&
              run.groupRef === indeterminateGroupRef &&
              run.positionId === positionId)
          : positionId !== null
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
