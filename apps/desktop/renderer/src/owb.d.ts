/** Typed shape of the whitelisted preload bridge (window.owb). */

import type { HealthResponse } from "@org-workbench/shared";

interface OwbApiResponse {
  status: number;
  body: unknown;
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
