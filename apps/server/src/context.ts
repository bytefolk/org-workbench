import type { OrgApplyDriver, TurnRunDriver } from "@org-workbench/shared";
import type { EventBus } from "./bus.js";
import type { WorkspaceState } from "./workspace-state.js";
import type { ServerConfig } from "./config.js";
import type { TurnStore } from "./turns/store.js";
import type { RunningTurnRegistry } from "./turns/running.js";
import type { SessionStore } from "./sessions/store.js";
import type { ContextExportService } from "./context-export/exporter.js";

export interface ControlPlaneContext {
  config: ServerConfig;
  workspace: WorkspaceState;
  bus: EventBus;
  /** Engine seam: spawn-based driver for the pinned digital-employee CLI. */
  driver: OrgApplyDriver;
  /** D3 engine spawn seam; only qoder/claude-code are accepted by the route. */
  turnDriver: TurnRunDriver;
  /** Workspace-local conversation/turn persistence. */
  turnStore: TurnStore;
  /** Abort hooks for in-flight turns, keyed by positionId; backs POST /turns/cancel. */
  runningTurns: RunningTurnRegistry;
  /** Explicit workspace-local session lifecycle; never a Host auth session. */
  sessionStore: SessionStore;
  /** Server-owned durable turn exporter; never exposed to renderer/IPC. */
  contextExporter: ContextExportService;
}
