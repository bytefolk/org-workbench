/**
 * D3 local turn-control contracts. The execution wire mirrors the
 * digital-employee `turn-envelope.v1` / `engine.v1` source of truth; this
 * package only adds workbench-local persistence records.
 */

export const TURN_ENVELOPE_SCHEMA_VERSION = "turn-envelope.v1" as const;
export const TURN_RECORD_SCHEMA_VERSION = "turn-record.v1" as const;
export const TURN_HISTORY_SCHEMA_VERSION = "turn-history.v1" as const;

export const turnEngines = ["qoder", "claude-code", "claude-local"] as const;
export type TurnEngine = (typeof turnEngines)[number];

export type TurnTerminalReason =
  | "goal_met"
  | "invalid_output_exhausted"
  | "turn_budget_exceeded"
  | "position_budget_exceeded"
  | "iteration_cap"
  | "doom_loop"
  | "deadline_exceeded"
  | "cancelled"
  | "engine_internal_error";

interface EngineEventBase {
  runId: string;
  timestamp: string;
}

export type EngineEvent =
  | (EngineEventBase & { type: "run.started" })
  | (EngineEventBase & { type: "model.delta"; text: string })
  | (EngineEventBase & {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    })
  | (EngineEventBase & {
      type: "run.completed";
      output: unknown;
      terminalReason: "goal_met";
    })
  | (EngineEventBase & {
      type: "run.failed";
      error: {
        code: string;
        message: string;
        retryable: boolean;
        terminalReason: TurnTerminalReason;
      };
    });

export interface TurnEnvelope {
  schemaVersion: typeof TURN_ENVELOPE_SCHEMA_VERSION;
  workspaceRef: string;
  positionId: string;
  turnId: string;
  input: string;
  envelopeDigest: string;
}

export interface TurnRunRequest {
  workspace: string;
  positionId: string;
  engine: TurnEngine;
  envelope: TurnEnvelope;
  /** Called once for each strictly validated engine.v1 event. */
  onEvent?: (event: EngineEvent) => void;
}

export type TurnRunResult =
  | { status: "trusted"; events: EngineEvent[]; diagnostic: string }
  | {
      status: "indeterminate";
      events: EngineEvent[];
      diagnostic: string;
      code: string;
    };

export interface TurnRunDriver {
  turnRun(request: TurnRunRequest): Promise<TurnRunResult>;
}

export type TurnRecordStatus = "running" | "completed" | "failed" | "indeterminate";

export interface TurnRecord {
  schemaVersion: typeof TURN_RECORD_SCHEMA_VERSION;
  conversationId: string;
  turnId: string;
  positionId: string;
  engine: TurnEngine;
  status: TurnRecordStatus;
  input: string;
  envelopeDigest: string;
  createdAt: string;
  updatedAt: string;
  events: EngineEvent[];
  runId?: string;
  output?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export interface TurnHistory {
  schemaVersion: typeof TURN_HISTORY_SCHEMA_VERSION;
  conversationId: string;
  positionId: string;
  turns: TurnRecord[];
}
