import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { OwbBridge } from "../src/owb";

function installBridge(overrides: Partial<OwbBridge> = {}): void {
  const bridge: OwbBridge = {
    status: vi.fn().mockResolvedValue({
      running: true,
      port: 43123,
      health: {
        status: "ok",
        api: "v0",
        server: { version: "0.0.0", pid: 123 },
        engine: { command: "digital-employee", available: true, version: "main" },
        workspace: { open: false },
      },
    }),
    openWorkspace: vi.fn().mockResolvedValue({ canceled: true }),
    workspace: vi.fn().mockResolvedValue({ status: 200, body: { open: false } }),
    orgTree: vi.fn().mockResolvedValue({ status: 200, body: null }),
    position: vi.fn().mockResolvedValue({ status: 404, body: { code: "position_missing" } }),
    sseStatus: vi.fn().mockResolvedValue("connected"),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    onSseStatus: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  Object.defineProperty(window, "owb", { configurable: true, value: bridge });
}

describe("App runtime bridge", () => {
  it("renders the real engine health shape and reads the current SSE status", async () => {
    installBridge();

    render(<App />);

    expect(await screen.findByText("引擎可用")).toBeInTheDocument();
    expect(await screen.findByText("尚未打开工作区")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(screen.queryByText("事件流重连中…")).not.toBeInTheDocument();
    });
  });
});
