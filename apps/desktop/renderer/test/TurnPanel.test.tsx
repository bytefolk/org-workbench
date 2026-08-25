import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TurnPanel } from "../src/turns";
import type { CreateTurnRequest, TurnEngine, TurnPanelProps, TurnRecord } from "../src/turns";

const positions = [
  { id: "repo-owner", name: "代码库负责人" },
  { id: "release-manager", name: "发布负责人" },
];

const availability: TurnPanelProps["engineAvailability"] = {
  qoder: { configured: true, ready: true },
  "claude-code": { configured: true, ready: true },
  "claude-local": { configured: true, ready: true },
  "local-mock": { configured: true, ready: true, reason: "本地 mock host：仅原型演示，非真实执行" },
};

function ControlledPanel({ onCreateTurn }: { onCreateTurn: (request: CreateTurnRequest) => void }) {
  const [positionId, setPositionId] = useState<string | null>("repo-owner");
  const [engine, setEngine] = useState<TurnEngine>("qoder");
  return (
    <TurnPanel
      workspaceOpen
      positions={positions}
      selectedPositionId={positionId}
      engine={engine}
      engineAvailability={availability}
      turns={[]}
      onSelectPosition={setPositionId}
      onSelectEngine={setEngine}
      onCreateTurn={onCreateTurn}
    />
  );
}

function turn(overrides: Partial<TurnRecord>): TurnRecord {
  return {
    id: "turn-1",
    positionId: "repo-owner",
    positionName: "代码库负责人",
    engine: "qoder",
    input: "检查发布门禁",
    status: "completed",
    createdAt: "2026-08-24T04:00:00.000Z",
    output: "门禁已检查。",
    ...overrides,
  };
}

describe("TurnPanel Issue #5 D3 behavior", () => {
  it("addresses a position, switches between the contracted Hosts, and creates a turn", async () => {
    const createTurn = vi.fn();
    render(<ControlledPanel onCreateTurn={createTurn} />);

    const positionSelect = screen.getByRole("combobox", { name: "选择对话岗位" });
    fireEvent.change(positionSelect, { target: { value: "release-manager" } });
    expect(screen.getByRole("heading", { name: "@发布负责人" })).toBeInTheDocument();

    const hostSelect = screen.getByRole("combobox", { name: "选择 Agent Host" });
    expect(within(hostSelect).getAllByRole("option")).toHaveLength(4);
    expect(within(hostSelect).getByRole("option", { name: /Claude Code · 本地登录/ })).toBeInTheDocument();
    fireEvent.change(hostSelect, { target: { value: "claude-code" } });

    fireEvent.change(screen.getByLabelText("交办任务"), { target: { value: "准备发布说明" } });
    fireEvent.click(screen.getByRole("button", { name: "发送任务" }));

    await waitFor(() => {
      expect(createTurn).toHaveBeenCalledWith({
        positionId: "release-manager",
        engine: "claude-code",
        input: "准备发布说明",
      });
    });

    fireEvent.change(hostSelect, { target: { value: "claude-local" } });
    fireEvent.change(screen.getByLabelText("交办任务"), { target: { value: "用本地登录复查一遍" } });
    fireEvent.click(screen.getByRole("button", { name: "发送任务" }));

    await waitFor(() => {
      expect(createTurn).toHaveBeenCalledWith({
        positionId: "release-manager",
        engine: "claude-local",
        input: "用本地登录复查一遍",
      });
    });
  });

  it("honestly disables idle states when the workspace or selected Host is unavailable", () => {
    const { rerender } = render(
      <TurnPanel
        workspaceOpen={false}
        positions={positions}
        selectedPositionId="repo-owner"
        engine="qoder"
        engineAvailability={availability}
        turns={[]}
        onSelectPosition={vi.fn()}
        onSelectEngine={vi.fn()}
        onCreateTurn={vi.fn()}
      />,
    );

    expect(screen.getByText("打开工作区后才能开始对话")).toBeInTheDocument();
    expect(screen.getByLabelText("交办任务")).toBeDisabled();

    rerender(
      <TurnPanel
        workspaceOpen
        positions={positions}
        selectedPositionId={null}
        engine="qoder"
        engineAvailability={availability}
        turns={[]}
        onSelectPosition={vi.fn()}
        onSelectEngine={vi.fn()}
        onCreateTurn={vi.fn()}
      />,
    );

    expect(screen.getByText("先从组织树或 @ 选择器选择岗位")).toBeInTheDocument();
    expect(screen.getByLabelText("交办任务")).toBeDisabled();

    rerender(
      <TurnPanel
        workspaceOpen
        positions={positions}
        selectedPositionId="repo-owner"
        engine="qoder"
        engineAvailability={{
          ...availability,
          qoder: { configured: false, ready: false, reason: "Qoder 凭据未配置" },
        }}
        turns={[]}
        onSelectPosition={vi.fn()}
        onSelectEngine={vi.fn()}
        onCreateTurn={vi.fn()}
      />,
    );

    expect(screen.getByText("Qoder 凭据未配置")).toBeInTheDocument();
    expect(screen.getByLabelText("交办任务")).toBeDisabled();
  });

  it("renders local status and digest evidence without inventing delegation or recall", () => {
    render(
      <TurnPanel
        workspaceOpen
        positions={positions}
        selectedPositionId="repo-owner"
        engine="qoder"
        engineAvailability={availability}
        turns={[
          turn({ id: "running", status: "running", output: undefined }),
          turn({ id: "completed", status: "completed" }),
          turn({ id: "failed", status: "failed", output: undefined, error: "模型执行失败" }),
          turn({
            id: "unknown",
            status: "indeterminate",
            output: undefined,
            error: "进程退出码 1",
            envelopeDigest: "sha256:1234567890abcdefghijklmnopqrstuv",
            evidenceDigest: "sha256:abcdefghijklmnopqrstuvwxyz123456",
          }),
        ]}
        onSelectPosition={vi.fn()}
        onSelectEngine={vi.fn()}
        onCreateTurn={vi.fn()}
      />,
    );

    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("状态未知")).toBeInTheDocument();
    expect(screen.getByTitle("sha256:1234567890abcdefghijklmnopqrstuv")).toBeInTheDocument();
    expect(screen.getByTitle("sha256:abcdefghijklmnopqrstuvwxyz123456")).toBeInTheDocument();
    expect(screen.getByText("委派链", { exact: false })).toHaveTextContent("Planned");
    expect(screen.getByText("长期 Context", { exact: false })).toHaveTextContent("Planned");
    expect(screen.queryByText(/researcher|worker|已召回|已委派/i)).not.toBeInTheDocument();
  });

  it("does not auto-retry an indeterminate turn and explicit retry creates a new request", async () => {
    const createTurn = vi.fn();
    render(
      <TurnPanel
        workspaceOpen
        positions={positions}
        selectedPositionId="repo-owner"
        engine="qoder"
        engineAvailability={availability}
        turns={[
          turn({
            id: "turn-uncertain",
            status: "indeterminate",
            output: undefined,
            error: "runner_lost",
          }),
        ]}
        onSelectPosition={vi.fn()}
        onSelectEngine={vi.fn()}
        onCreateTurn={createTurn}
      />,
    );

    expect(createTurn).not.toHaveBeenCalled();
    expect(screen.getByText(/系统不会自动重试/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建新回合重试" }));
    await waitFor(() => {
      expect(createTurn).toHaveBeenCalledTimes(1);
      expect(createTurn).toHaveBeenCalledWith({
        positionId: "repo-owner",
        engine: "qoder",
        input: "检查发布门禁",
        retryOf: "turn-uncertain",
      });
    });
    expect(screen.getByText("turn-uncertain")).toBeInTheDocument();
  });
});
