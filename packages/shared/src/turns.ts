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

/** Capability-gate action kinds; verbatim mirror of the engine #187 vocabulary. */
export type TurnApprovalActionKind = "exec" | "write" | "network" | "tool";

/**
 * Approval event shapes mirror digital-employee engine.v1 (#187 Option 1,
 * terminal-and-resume) verbatim: the requesting run settles as a retryable
 * run.failed(engine.approval_required); the verdict returns via the next
 * turn's sealed envelope, never through an in-run channel.
 */
export interface ApprovalRequestedEvent extends EngineEventBase {
  type: "approval.requested";
  approvalId: string;
  action: {
    kind: TurnApprovalActionKind;
    description: string;
    target?: string;
  };
  reason?: string;
  expiresAt?: string;
}

export interface ApprovalGrantedEvent extends EngineEventBase {
  type: "approval.granted";
  approvalId: string;
  grantedBy: "operator";
  scope: "once" | "run";
}

export interface ApprovalDeniedEvent extends EngineEventBase {
  type: "approval.denied";
  approvalId: string;
  deniedBy: "operator";
  reason?: string;
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
    })
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalDeniedEvent;

/**
 * Operator verdict carried by the resume turn's envelope (#193). Shape is
 * the engine TurnPendingApprovalInput verbatim — no parallel vocabulary.
 */
export interface TurnPendingApproval {
  approvalId: string;
  decision: "granted" | "denied";
  decidedBy: "operator";
  scope?: "once" | "run";
  reason?: string;
  expiresAt?: string;
}

export interface TurnEnvelope {
  schemaVersion: typeof TURN_ENVELOPE_SCHEMA_VERSION;
  workspaceRef: string;
  positionId: string;
  turnId: string;
  input: string;
  pendingApproval?: TurnPendingApproval;
  envelopeDigest: string;
}

export interface TurnRunRequest {
  workspace: string;
  positionId: string;
  engine: TurnEngine;
  envelope: TurnEnvelope;
  /** Called once for each strictly validated engine.v1 event. */
  onEvent?: (event: EngineEvent) => void;
  /** Registers a control-plane hook that terminates the engine process. */
  setAbort?: (abort: () => void) => void;
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
  /** Additive #52 (DS-34-001 rev-1 缺口①过渡): local conversationRef of the
   * spawning group; absent for personal turns. Contract-level conversationRef
   * lands with the upstream v1alpha2 de issue; until then this local link is
   * the registered transition debt. */
  groupRef?: string;
}

export interface TurnHistory {
  schemaVersion: typeof TURN_HISTORY_SCHEMA_VERSION;
  conversationId: string;
  positionId: string;
  turns: TurnRecord[];
}
