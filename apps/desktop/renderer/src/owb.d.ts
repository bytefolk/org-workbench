/** Typed shape of the whitelisted preload bridge (window.owb). */

interface OwbApiResponse {
  status: number;
  body: unknown;
}

export interface OwbBridge {
  status(): Promise<OwbApiResponse>;
  openWorkspace(): Promise<OwbApiResponse>;
  workspace(): Promise<OwbApiResponse>;
  orgTree(): Promise<OwbApiResponse>;
  position(positionId: string): Promise<OwbApiResponse>;
  onEvent(callback: (event: unknown) => void): () => void;
  onSseStatus(callback: (state: "connecting" | "connected") => void): () => void;
}

declare global {
  interface Window {
    owb: OwbBridge;
  }
}

export {};
