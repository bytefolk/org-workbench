/**
 * Control-plane API contract constants (frozen at v0, see docs/api-contract-v0.md).
 *
 * Single source of truth for endpoint routes, the version header, and the SSE
 * event vocabulary. Server and desktop shell both consume these constants so a
 * route can never drift between implementation and contract.
 */

export const API_VERSION = "v0" as const;

/** Response header carrying the contract version on every response. */
export const API_VERSION_HEADER = "x-orgworkbench-api" as const;

export const routes = {
  health: "/health",
  workspace: "/workspace",
  workspaceOpen: "/workspace/open",
  orgTree: "/org/tree",
  orgApply: "/org/apply",
  positions: "/positions",
  reports: "/reports",
  events: "/events",
} as const;

export type RoutePath = (typeof routes)[keyof typeof routes];

/**
 * SSE event vocabulary. D0 emits `org.updated` only; `turn.*`,
 * `escalation.created`, and `evidence.created` are reserved shapes wired in
 * D3/D4 against the engine S1 turn contract (#165).
 */
export const sseEventTypes = [
  "org.updated",
  "turn.started",
  "turn.completed",
  "escalation.created",
  "evidence.created",
] as const;

export type SseEventType = (typeof sseEventTypes)[number];

export interface SseEventEnvelope<T = unknown> {
  /** Monotonic per-server sequence; used as SSE id and for resume. */
  seq: number;
  type: SseEventType;
  at: string;
  payload: T;
}
