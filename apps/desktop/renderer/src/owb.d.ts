/** Typed shape of the whitelisted preload bridge (window.owb). */

import type {
  HealthResponse,
  ChangeManifest,
  OrgBackupsResponse,
  OrgRestoreResult,
  ReportsResponse,
  TurnEngine,
  TurnHistory,
  TurnRecord,
  WorkbenchSession,
  WorkbenchSessionList,
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
  orgApply(manifest: ChangeManifest): Promise<OwbApiResponse>;
  orgBackups(): Promise<OwbApiResponse<OrgBackupsResponse>>;
  orgRestore(backupId: string): Promise<OwbApiResponse<OrgRestoreResult>>;
  reports(): Promise<OwbApiResponse<ReportsResponse>>;
  position(positionId: string): Promise<OwbApiResponse>;
  createTurn(request: { positionId: string; input: string; engine: TurnEngine }): Promise<OwbApiResponse<TurnRecord>>;
  turnHistory(positionId: string): Promise<OwbApiResponse<TurnHistory>>;
  createSession(request: { positionId: string }): Promise<OwbApiResponse<WorkbenchSession>>;
  sessions(positionId: string): Promise<OwbApiResponse<WorkbenchSessionList>>;
  session(sessionId: string): Promise<OwbApiResponse<WorkbenchSession>>;
  rotateSession(sessionId: string): Promise<OwbApiResponse<WorkbenchSession>>;
  createSessionTurn(request: { sessionId: string; input: string; engine: TurnEngine }): Promise<OwbApiResponse<TurnRecord>>;
  sessionTurnHistory(sessionId: string): Promise<OwbApiResponse<TurnHistory>>;
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
