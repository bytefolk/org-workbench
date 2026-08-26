/** Typed shape of the whitelisted preload bridge (window.owb). */

import type {
  GroupConversation,
  GroupConversationList,
  GroupTimeline,
  HealthResponse,
  ChangeManifest,
  HirePositionRequest,
  HireResult,
  OrgBackupsResponse,
  OrgRestoreResult,
  OrgUndoResult,
  ReportsResponse,
  TurnEngine,
  TurnHistory,
  TurnPendingApproval,
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
  orgUndo(): Promise<OwbApiResponse<OrgUndoResult>>;
  hire(request: HirePositionRequest): Promise<OwbApiResponse<HireResult>>;
  reports(): Promise<OwbApiResponse<ReportsResponse>>;
  position(positionId: string): Promise<OwbApiResponse>;
  createTurn(request: { positionId: string; input: string; engine: TurnEngine; pendingApproval?: TurnPendingApproval }): Promise<OwbApiResponse<TurnRecord>>;
  cancelTurn(positionId: string): Promise<OwbApiResponse<{ cancelled: boolean; positionId: string }>>;
  turnHistory(positionId: string): Promise<OwbApiResponse<TurnHistory>>;
  createSession(request: { positionId: string }): Promise<OwbApiResponse<WorkbenchSession>>;
  sessions(positionId: string): Promise<OwbApiResponse<WorkbenchSessionList>>;
  session(sessionId: string): Promise<OwbApiResponse<WorkbenchSession>>;
  rotateSession(sessionId: string): Promise<OwbApiResponse<WorkbenchSession>>;
  createSessionTurn(request: { sessionId: string; input: string; engine: TurnEngine; pendingApproval?: TurnPendingApproval }): Promise<OwbApiResponse<TurnRecord>>;
  sessionTurnHistory(sessionId: string): Promise<OwbApiResponse<TurnHistory>>;
  createGroup(request: { memberPositionIds: string[] }): Promise<OwbApiResponse<GroupConversation>>;
  groups(): Promise<OwbApiResponse<GroupConversationList>>;
  group(conversationRef: string): Promise<OwbApiResponse<GroupConversation>>;
  addGroupMember(request: { conversationRef: string; positionId: string }): Promise<OwbApiResponse<GroupConversation>>;
  createGroupTurn(request: { conversationRef: string; input: string; engine: TurnEngine; mentions: string[] }): Promise<OwbApiResponse<{ conversationRef: string; messageId: string; spawns: Array<{ turnId: string; positionId: string }> }>>;
  groupTimeline(conversationRef: string): Promise<OwbApiResponse<GroupTimeline>>;
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
