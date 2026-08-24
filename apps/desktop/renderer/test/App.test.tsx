import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { OwbBridge } from "../src/owb";
import type { ReportsResponse, TurnHistory, TurnRecord } from "@org-workbench/shared";

function installBridge(overrides: Partial<OwbBridge> = {}): OwbBridge {
  const bridge: OwbBridge = {
    status: vi.fn().mockResolvedValue({
      running: true,
      port: 43123,
      health: {
        status: "ok",
        api: "v0",
        server: { version: "0.0.0", pid: 123 },
        engine: { command: "digital-employee", available: true, version: "main" },
        hosts: {
          qoder: { configured: false, ready: false, nextStep: "设置 QODER_PERSONAL_ACCESS_TOKEN 后重启工作台" },
          "claude-code": { configured: false, ready: false, nextStep: "设置 ANTHROPIC_API_KEY 后重启工作台" },
        },
        workspace: { open: false },
      },
    }),
    openWorkspace: vi.fn().mockResolvedValue({ canceled: true }),
    workspace: vi.fn().mockResolvedValue({ status: 200, body: { open: false } }),
    orgTree: vi.fn().mockResolvedValue({ status: 200, body: null }),
    orgApply: vi.fn().mockResolvedValue({ status: 500, body: { code: "internal" } }),
    orgBackups: vi.fn().mockResolvedValue({ status: 200, body: { schemaVersion: "org-backups.v1", backups: [] } }),
    orgRestore: vi.fn().mockResolvedValue({ status: 404, body: { code: "restore_invalid" } }),
    reports: vi.fn().mockResolvedValue({ status: 200, body: emptyReports() }),
    position: vi.fn().mockResolvedValue({ status: 404, body: { code: "position_missing" } }),
    createTurn: vi.fn().mockResolvedValue({ status: 500, body: { code: "internal", message: "unexpected" } }),
    turnHistory: vi.fn().mockResolvedValue({
      status: 200,
      body: { schemaVersion: "turn-history.v1", conversationId: "empty", positionId: "repo-owner", turns: [] },
    }),
    sseStatus: vi.fn().mockResolvedValue("connected"),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    onSseStatus: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  Object.defineProperty(window, "owb", { configurable: true, value: bridge });
  return bridge;
}

const snapshot = {
  schemaVersion: "org-tree.v1" as const,
  business: "开源业务",
  owner: "repo-owner",
  updatedAt: "2026-08-24T04:00:00.000Z",
  positionCount: 1,
  depth: 1,
  tree: [{
    id: "repo-owner",
    reportTo: null,
    budget: { perTask: { tokens: 1000 }, perDay: { tokens: 5000 } },
    children: [],
  }],
};

const position = {
  id: "repo-owner",
  name: "代码库负责人",
  description: "负责开源仓库",
  reportTo: null,
  mode: "approval_required" as const,
  contextScope: "position",
  permissions: { toolAllow: [], toolDeny: [] },
  budget: { perTask: { tokens: 1000 }, perDay: { tokens: 5000 } },
  metadata: {},
};

function apiTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    schemaVersion: "turn-record.v1",
    conversationId: "conversation-1",
    turnId: "turn-existing",
    positionId: "repo-owner",
    engine: "qoder",
    status: "completed",
    input: "历史任务",
    envelopeDigest: "sha256:existing",
    createdAt: "2026-08-24T04:00:00.000Z",
    updatedAt: "2026-08-24T04:01:00.000Z",
    events: [],
    output: "历史结果",
    ...overrides,
  };
}

function history(turns: TurnRecord[]): TurnHistory {
  return {
    schemaVersion: "turn-history.v1",
    conversationId: "conversation-1",
    positionId: "repo-owner",
    turns,
  };
}

function openedBridge(overrides: Partial<OwbBridge> = {}): OwbBridge {
  return installBridge({
    status: vi.fn().mockResolvedValue({
      running: true,
      health: {
        status: "ok",
        api: "v0",
        server: { version: "0.0.0", pid: 123 },
        engine: { command: "digital-employee", available: true, version: "main" },
        hosts: {
          qoder: { configured: true, ready: true },
          "claude-code": { configured: false, ready: false, nextStep: "设置 ANTHROPIC_API_KEY 后重启工作台" },
        },
        workspace: { open: true, path: "/fixture/workspace" },
      },
    }),
    workspace: vi.fn().mockResolvedValue({
      status: 200,
      body: { open: true, path: "/fixture/workspace", business: "开源业务" },
    }),
    orgTree: vi.fn().mockResolvedValue({ status: 200, body: snapshot }),
    position: vi.fn().mockResolvedValue({ status: 200, body: { position } }),
    ...overrides,
  });
}

function emptyReports(): ReportsResponse {
  return { schemaVersion: "reports.v1", streams: { escalations: [], audits: [], evidence: [] }, budgets: [], page: { cursor: null, hasMore: false } };
}

async function selectRepoOwner(): Promise<void> {
  await screen.findByRole("option", { name: "代码库负责人 · repo-owner" });
  fireEvent.click(screen.getByText("repo-owner", { selector: ".ui-org-tree__label" }));
  expect(await screen.findByRole("heading", { name: "@代码库负责人" })).toBeInTheDocument();
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

  it("opens a workspace, selects @岗位, loads local history, sends, and reads persisted history back", async () => {
    const existing = apiTurn();
    const created = apiTurn({
      turnId: "turn-created",
      input: "检查下一版发布",
      output: "发布门禁通过",
      createdAt: "2026-08-24T05:00:00.000Z",
      updatedAt: "2026-08-24T05:01:00.000Z",
      envelopeDigest: "sha256:created",
    });
    const turnHistory = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: history([existing]) })
      .mockResolvedValueOnce({ status: 200, body: history([existing, created]) });
    const createTurn = vi.fn().mockResolvedValue({ status: 200, body: created });
    const bridge = openedBridge({ turnHistory, createTurn });

    render(<App />);
    await selectRepoOwner();
    expect(await screen.findByText("历史结果")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("交办任务"), { target: { value: "检查下一版发布" } });
    fireEvent.click(screen.getByRole("button", { name: "发送任务" }));

    await waitFor(() => {
      expect(createTurn).toHaveBeenCalledWith({
        positionId: "repo-owner",
        input: "检查下一版发布",
        engine: "qoder",
      });
      expect(turnHistory).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("发布门禁通过")).toBeInTheDocument();
    expect(bridge.position).toHaveBeenCalledWith("repo-owner");
  });

  it("keeps an unconfigured Host honestly idle even when the engine CLI is reachable", async () => {
    openedBridge({
      status: vi.fn().mockResolvedValue({
        running: true,
        health: {
          status: "ok",
          api: "v0",
          server: { version: "0.0.0", pid: 123 },
          engine: { command: "digital-employee", available: true },
          hosts: {
            qoder: { configured: false, ready: false, nextStep: "Qoder 凭据未配置" },
            "claude-code": { configured: false, ready: false, nextStep: "Claude Code 凭据未配置" },
          },
          workspace: { open: true, path: "/fixture/workspace" },
        },
      }),
      turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }),
    });

    render(<App />);
    await selectRepoOwner();
    expect(screen.getByText("Qoder 凭据未配置")).toBeInTheDocument();
    expect(screen.getByLabelText("交办任务")).toBeDisabled();
  });

  it("surfaces create-turn API failure and preserves the unsent input", async () => {
    const createTurn = vi.fn().mockResolvedValue({
      status: 503,
      body: { code: "turn_engine_unavailable", message: "Qoder Host 暂不可用", retryable: false },
    });
    openedBridge({
      turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }),
      createTurn,
    });

    render(<App />);
    await selectRepoOwner();
    const input = screen.getByLabelText("交办任务");
    fireEvent.change(input, { target: { value: "不要丢失这条任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("turn_engine_unavailable: Qoder Host 暂不可用");
    expect(input).toHaveValue("不要丢失这条任务");
    expect(createTurn).toHaveBeenCalledTimes(1);
  });

  it("submits a drag move proposal and rejects a self-drop before IPC", async () => {
    const tree = {
      ...snapshot,
      positionCount: 3,
      depth: 2,
      tree: [{ ...snapshot.tree[0]!, children: [
        { id: "docs-writer", reportTo: "repo-owner", budget: snapshot.tree[0]!.budget, children: [] },
        { id: "release-engineer", reportTo: "repo-owner", budget: snapshot.tree[0]!.budget, children: [] },
      ] }],
    };
    const orgApply = vi.fn().mockResolvedValue({ status: 200, body: { status: "applied" } });
    openedBridge({
      orgTree: vi.fn().mockResolvedValue({ status: 200, body: tree }),
      position: vi.fn().mockImplementation(async (id: string) => ({ status: 200, body: { position: { ...position, id, name: id, reportTo: id === "repo-owner" ? null : "repo-owner" } } })),
      orgApply,
      turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }),
    });
    render(<App />);
    const source = await screen.findByText("docs-writer", { selector: ".ui-org-tree__label" });
    const target = screen.getByText("release-engineer", { selector: ".ui-org-tree__label" });
    const data = new Map<string, string>();
    const dataTransfer = { effectAllowed: "move", dropEffect: "move", setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "" };
    fireEvent.dragStart(source.closest('[role="treeitem"]')!, { dataTransfer });
    fireEvent.drop(target.closest('[role="treeitem"]')!, { dataTransfer });
    await waitFor(() => expect(orgApply).toHaveBeenCalledWith({ schemaVersion: "change-manifest.v1", changes: [{ op: "move", id: "docs-writer", reportTo: "release-engineer" }] }));

    fireEvent.dragStart(source.closest('[role="treeitem"]')!, { dataTransfer });
    fireEvent.drop(source.closest('[role="treeitem"]')!, { dataTransfer });
    expect(await screen.findByRole("alert")).toHaveTextContent("非法投放");
    expect(orgApply).toHaveBeenCalledTimes(1);
  });

  it("keeps hire disabled until token budgets are complete, then applies one add manifest", async () => {
    const orgApply = vi.fn().mockResolvedValue({ status: 200, body: { status: "applied" } });
    openedBridge({ orgApply, turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "招聘岗位" }));
    expect(screen.getByRole("button", { name: "确认招聘" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("岗位 ID"), { target: { value: "docs-writer" } });
    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "文档负责人" } });
    fireEvent.change(screen.getByLabelText("职责描述"), { target: { value: "维护文档" } });
    fireEvent.change(screen.getByLabelText("单任务 tokens"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("单日 tokens"), { target: { value: "200000" } });
    expect(screen.getByRole("button", { name: "确认招聘" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认招聘" }));
    await waitFor(() => expect(orgApply).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: "change-manifest.v1",
      changes: [expect.objectContaining({ op: "add", position: expect.objectContaining({ id: "docs-writer", budget: { perTask: { tokens: 20000 }, perDay: { tokens: 200000 } } }) })],
    })));
  });

  it("requires dismissal confirmation and invokes one-click restore through typed IPC", async () => {
    const childSnapshot = { ...snapshot, positionCount: 2, depth: 2, tree: [{ ...snapshot.tree[0]!, children: [{ id: "docs-writer", reportTo: "repo-owner", budget: snapshot.tree[0]!.budget, children: [] }] }] };
    const orgApply = vi.fn().mockResolvedValue({ status: 200, body: { status: "applied" } });
    const orgRestore = vi.fn().mockResolvedValue({ status: 200, body: { status: "applied", positionId: "old-writer", restored: true } });
    openedBridge({
      orgTree: vi.fn().mockResolvedValue({ status: 200, body: childSnapshot }),
      position: vi.fn().mockImplementation(async (id: string) => ({ status: 200, body: { position: { ...position, id, name: id, reportTo: id === "repo-owner" ? null : "repo-owner" } } })),
      orgApply,
      orgBackups: vi.fn().mockResolvedValue({ status: 200, body: { schemaVersion: "org-backups.v1", backups: [{ backupId: "old-writer-1756000000000-abcdef", positionId: "old-writer", dismissedAt: "2026-08-24T06:00:00Z", reportTo: "repo-owner", name: "旧文档负责人" }] } }),
      orgRestore,
      turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }),
    });
    render(<App />);
    fireEvent.click(await screen.findByText("docs-writer", { selector: ".ui-org-tree__label" }));
    fireEvent.click(await screen.findByRole("button", { name: "裁撤" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(orgApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "裁撤" }));
    fireEvent.click(screen.getByRole("button", { name: "确认裁撤并留痕" }));
    await waitFor(() => expect(orgApply).toHaveBeenCalledWith({ schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id: "docs-writer" }] }));

    fireEvent.click(screen.getByRole("button", { name: "一键恢复" }));
    await waitFor(() => expect(orgRestore).toHaveBeenCalledWith("old-writer-1756000000000-abcdef"));
  });

  it("renders D4 tabs from sanitized report facts and never displays raw turn content", async () => {
    const reports: ReportsResponse = {
      schemaVersion: "reports.v1",
      streams: {
        escalations: [{ schemaVersion: "turn-escalation.v1", positionId: "repo-owner", turnId: "turn-1", at: "2026-08-24T06:00:00Z", status: "failed", code: "position_budget_exceeded", reportingChain: ["repo-owner"], budgetRelated: true }],
        audits: [],
        evidence: [{ schemaVersion: "turn-evidence.v1", positionId: "repo-owner", turnId: "turn-1", conversationId: "conversation-1", engine: "qoder", status: "failed", createdAt: "2026-08-24T05:59:00Z", updatedAt: "2026-08-24T06:00:00Z", envelopeDigest: "sha256:evidence", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, errorCode: "position_budget_exceeded" }],
      },
      budgets: [{
        positionId: "repo-owner",
        declared: { perTask: { tokens: 100 }, perDay: { tokens: 1000 } },
        recorded: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        latestTurn: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        state: "within",
      }],
      page: { cursor: null, hasMore: false },
    };
    openedBridge({ reports: vi.fn().mockResolvedValue({ status: 200, body: reports }), turnHistory: vi.fn().mockResolvedValue({ status: 200, body: history([]) }) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "上报" }));
    expect(await screen.findByRole("heading", { name: "上报中心" })).toBeInTheDocument();
    expect(screen.getByText("position_budget_exceeded")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "单任务消耗" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("meter", { name: "单日用量不可用" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getAllByText("50%")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /回合证据/ }));
    expect(screen.getByText("sha256:evidence")).toBeInTheDocument();
    expect(screen.queryByText("sensitive raw input")).not.toBeInTheDocument();
    expect(screen.queryByText("sensitive raw output")).not.toBeInTheDocument();
  });
});
