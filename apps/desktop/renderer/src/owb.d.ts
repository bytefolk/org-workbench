/** Typed shape of the whitelisted preload bridge (window.owb). */

import type {
  HealthResponse,
  TurnEngine,
  TurnHistory,
  TurnRecord,
} from "@org-workbench/shared";

interface OwbApiResponse<T = unknown> {
  status: number;
  body: T;
}

interface OwbStatusResponse {
  running: boolean;
  port?: number;
  health?: HealthResponse | null;
  error?: string | null;
  nextSteps?: string[];
}

export interface OwbBridge {
  status(): Promise<OwbStatusResponse>;
  openWorkspace(): Promise<OwbApiResponse>;
  workspace(): Promise<OwbApiResponse>;
  orgTree(): Promise<OwbApiResponse>;
  position(positionId: string): Promise<OwbApiResponse>;
  createTurn(request: { positionId: string; input: string; engine: TurnEngine }): Promise<OwbApiResponse<TurnRecord>>;
  turnHistory(positionId: string): Promise<OwbApiResponse<TurnHistory>>;
  sseStatus(): Promise<"connecting" | "connected">;
  onEvent(callback: (event: unknown) => void): () => void;
  onSseStatus(callback: (state: "connecting" | "connected") => void): () => void;
}

declare global {
  interface Window {
    owb: OwbBridge;
  }
}

export {};
