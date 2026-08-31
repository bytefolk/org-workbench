import { describe, expect, it } from "vitest";
import {
  createMcpServerDraft,
  createMcpToolDraft,
  isMcpGrantValid,
  isMcpServerValid,
  isMcpToolValid,
  parseHeaderLines,
  toMcpGrant,
  type McpServerDraft,
  type McpToolDraft,
} from "../src/org/mcp-grant";

const tool = (overrides?: Partial<McpToolDraft>): McpToolDraft => ({
  ...createMcpToolDraft(),
  name: "repo.read",
  ...overrides,
});

const stdioServer = (overrides?: Partial<McpServerDraft>): McpServerDraft => ({
  ...createMcpServerDraft(),
  name: "local-fs",
  type: "stdio",
  command: "mcp-fs",
  ...overrides,
});

const httpServer = (overrides?: Partial<McpServerDraft>): McpServerDraft => ({
  ...createMcpServerDraft(),
  name: "remote-api",
  type: "http",
  url: "https://mcp.example.com/v1",
  ...overrides,
});

describe("#89 MCP 授权草稿 → HireMcpGrant", () => {
  it("stdio 草稿转成上游形状，多行参数与环境变量按行拆分", () => {
    const grant = toMcpGrant(
      [tool()],
      [stdioServer({ args: "--root\n.\n", environment: "FS_ROOT\nHOME\n" })],
    );
    expect(grant).toEqual({
      tools: [{ name: "repo.read", requestedMode: "read" }],
      servers: [
        {
          name: "local-fs",
          transport: {
            type: "stdio",
            command: "mcp-fs",
            args: ["--root", "."],
            environment: ["FS_ROOT", "HOME"],
          },
        },
      ],
    });
  });

  it("http 草稿把 `Header=ENV` 行转成 valueFromEnv 映射，不内联任何值", () => {
    const grant = toMcpGrant([tool()], [httpServer({ headers: "Authorization=MCP_TOKEN\n" })]);
    expect(grant.servers[0]).toEqual({
      name: "remote-api",
      transport: {
        type: "http",
        url: "https://mcp.example.com/v1",
        headers: [{ name: "Authorization", valueFromEnv: "MCP_TOKEN" }],
      },
    });
  });

  it("空的可选字段不会出现在结果里（上游对缺省与空数组等价）", () => {
    const grant = toMcpGrant([tool()], [stdioServer()]);
    expect(grant.servers[0]!.transport).toEqual({ type: "stdio", command: "mcp-fs" });
  });

  it("parseHeaderLines 只在第一个等号处切分，保留值里的等号", () => {
    expect(parseHeaderLines("X-Key=A=B")).toEqual([{ name: "X-Key", valueFromEnv: "A=B" }]);
  });
});

describe("#89 表单级校验镜像上游规则", () => {
  it("工具名必须是小写标识符", () => {
    expect(isMcpToolValid(tool(), "approval_required")).toBe(true);
    expect(isMcpToolValid(tool({ name: "Bad Name" }), "approval_required")).toBe(false);
  });

  it("只读员工不能请求 write 工具（拒绝而非静默降级）", () => {
    const write = tool({ requestedMode: "write" });
    expect(isMcpToolValid(write, "approval_required")).toBe(true);
    expect(isMcpToolValid(write, "read_only")).toBe(false);
  });

  it("stdio 必须有命令，环境变量名必须是大写下划线格式", () => {
    expect(isMcpServerValid(stdioServer())).toBe(true);
    expect(isMcpServerValid(stdioServer({ command: "   " }))).toBe(false);
    expect(isMcpServerValid(stdioServer({ environment: "FS_ROOT" }))).toBe(true);
    expect(isMcpServerValid(stdioServer({ environment: "fs_root" }))).toBe(false);
  });

  it("http 只接受不带凭据与片段的 https 地址", () => {
    expect(isMcpServerValid(httpServer())).toBe(true);
    expect(isMcpServerValid(httpServer({ url: "http://mcp.example.com" }))).toBe(false);
    expect(isMcpServerValid(httpServer({ url: "https://user:pass@mcp.example.com" }))).toBe(false);
    expect(isMcpServerValid(httpServer({ url: "https://mcp.example.com/#frag" }))).toBe(false);
    expect(isMcpServerValid(httpServer({ url: "not a url" }))).toBe(false);
  });

  it("请求头值必须是环境变量名，明文密钥被拒", () => {
    expect(isMcpServerValid(httpServer({ headers: "Authorization=MCP_TOKEN" }))).toBe(true);
    expect(isMcpServerValid(httpServer({ headers: "Authorization=Bearer sk-live-123" }))).toBe(false);
  });

  it("工具与 server 必须同时非空，且各自名称不重复", () => {
    expect(isMcpGrantValid([tool()], [stdioServer()], "approval_required")).toBe(true);
    expect(isMcpGrantValid([], [stdioServer()], "approval_required")).toBe(false);
    expect(isMcpGrantValid([tool()], [], "approval_required")).toBe(false);
    expect(isMcpGrantValid([tool(), tool()], [stdioServer()], "approval_required")).toBe(false);
    expect(isMcpGrantValid([tool()], [stdioServer(), stdioServer()], "approval_required")).toBe(false);
  });
});
