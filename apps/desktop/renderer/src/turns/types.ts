export type TurnEngine = "qoder" | "claude-code" | "claude-local";

export type TurnStatus = "running" | "completed" | "failed" | "indeterminate";

export interface PositionMentionOption {
  id: string;
  name: string;
}

export interface TurnEngineAvailability {
  configured: boolean;
  ready: boolean;
  reason?: string;
}

export interface TurnRecord {
  id: string;
  positionId: string;
  positionName: string;
  engine: TurnEngine;
  input: string;
  status: TurnStatus;
  createdAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  /** Engine runId when the server record carries one; keys live-stream dedupe. */
  runId?: string;
  /** Live engine-reported usage; present only on provisional live rows. */
  totalTokens?: number;
  envelopeDigest?: string;
  evidenceDigest?: string;
  retryOf?: string;
}

export interface CreateTurnRequest {
  positionId: string;
  engine: TurnEngine;
  input: string;
  /** A retry always starts a new turn. This is provenance, never an id to mutate. */
  retryOf?: string;
}
