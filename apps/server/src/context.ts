import type { OrgApplyDriver } from "@org-workbench/shared";
import type { EventBus } from "./bus.js";
import type { WorkspaceState } from "./workspace-state.js";
import type { ServerConfig } from "./config.js";

export interface ControlPlaneContext {
  config: ServerConfig;
  workspace: WorkspaceState;
  bus: EventBus;
  /** Engine seam: spawn-based driver for the pinned digital-employee CLI. */
  driver: OrgApplyDriver;
}
