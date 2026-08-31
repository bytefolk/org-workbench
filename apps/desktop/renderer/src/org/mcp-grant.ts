// #89 MCP 授权表单模型。渲染层把「工具清单 + server 连接配置」编辑成字符串
// 草稿，提交前转成 HireMcpGrant；控制面 POST /hire 仍是权威校验闸门，这里只做
// 表单级即时反馈，规则逐条镜像 digital-employee 的两个上游校验器：
// employee-package.schema.json `policy.mcpTools` 与 employee-mcp.v1alpha1
// （packages/core/src/employee-mcp.ts）。凭据只以环境变量「名」出现，表单永远
// 不接收密钥值本身。

import type { HireMcpGrant, McpRequestedMode, McpServerRequest } from "@org-workbench/shared";

const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export interface McpToolDraft {
  name: string;
  requestedMode: McpRequestedMode;
}

export interface McpServerDraft {
  name: string;
  type: "stdio" | "http";
  /** stdio */
  command: string;
  /** stdio：一行一个参数 */
  args: string;
  /** stdio：一行一个环境变量名 */
  environment: string;
  /** http */
  url: string;
  /** http：一行一个 `Header-Name=ENV_VAR_NAME` */
  headers: string;
}

export function createMcpToolDraft(): McpToolDraft {
  return { name: "", requestedMode: "read" };
}

export function createMcpServerDraft(): McpServerDraft {
  return { name: "", type: "stdio", command: "", args: "", environment: "", url: "", headers: "" };
}

/** 多行文本 → 去空行的字符串数组。 */
export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `Header-Name=ENV_VAR` 一行一条；等号右侧是环境变量名，不是值。 */
export function parseHeaderLines(value: string): Array<{ name: string; valueFromEnv: string }> {
  return splitLines(value).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 0) return { name: line, valueFromEnv: "" };
    return {
      name: line.slice(0, separator).trim(),
      valueFromEnv: line.slice(separator + 1).trim(),
    };
  });
}

function serverFromDraft(draft: McpServerDraft): McpServerRequest {
  if (draft.type === "http") {
    const headers = parseHeaderLines(draft.headers);
    return {
      name: draft.name.trim(),
      transport: {
        type: "http",
        url: draft.url.trim(),
        ...(headers.length > 0 ? { headers } : {}),
      },
    };
  }
  const args = splitLines(draft.args);
  const environment = splitLines(draft.environment);
  return {
    name: draft.name.trim(),
    transport: {
      type: "stdio",
      command: draft.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(environment.length > 0 ? { environment } : {}),
    },
  };
}

/** 草稿 → HireMcpGrant（仅在 `isMcpGrantValid` 为真时提交）。 */
export function toMcpGrant(tools: McpToolDraft[], servers: McpServerDraft[]): HireMcpGrant {
  return {
    tools: tools.map((tool) => ({ name: tool.name.trim(), requestedMode: tool.requestedMode })),
    servers: servers.map(serverFromDraft),
  };
}

function uniqueTrimmedNames(values: string[]): boolean {
  const names = values.map((value) => value.trim());
  return new Set(names).size === names.length;
}

export function isMcpToolValid(tool: McpToolDraft, mode: "read_only" | "approval_required"): boolean {
  if (!IDENTIFIER_PATTERN.test(tool.name.trim())) return false;
  // 上游 read_only_employee_cannot_request_write_mcp_tools：只读员工不得请求
  // write 工具；这里直接拒绝而不是静默降级。
  return !(mode === "read_only" && tool.requestedMode === "write");
}

export function isMcpServerValid(server: McpServerDraft): boolean {
  if (!IDENTIFIER_PATTERN.test(server.name.trim())) return false;
  if (server.type === "stdio") {
    if (server.command.trim().length === 0 || server.command.length > 1_024) return false;
    const environment = splitLines(server.environment);
    if (environment.length > 128 || !environment.every((name) => ENVIRONMENT_NAME_PATTERN.test(name))) return false;
    const args = splitLines(server.args);
    return args.length <= 128 && new Set(args).size === args.length;
  }
  const url = server.url.trim();
  if (url.length === 0 || url.length > 2_000) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return false;
  const headers = parseHeaderLines(server.headers);
  if (headers.length > 64) return false;
  return headers.every(
    (header) => HEADER_NAME_PATTERN.test(header.name) && ENVIRONMENT_NAME_PATTERN.test(header.valueFromEnv),
  );
}

/**
 * 整块授权是否可提交：工具与 server 必须同时非空（上游要求 `policy.mcpTools`
 * 非空时必须带 `entrypoints.mcp`），且各自名称不重复、逐条合法。
 */
export function isMcpGrantValid(
  tools: McpToolDraft[],
  servers: McpServerDraft[],
  mode: "read_only" | "approval_required",
): boolean {
  if (tools.length === 0 || tools.length > 64) return false;
  if (servers.length === 0 || servers.length > 64) return false;
  if (!uniqueTrimmedNames(tools.map((tool) => tool.name))) return false;
  if (!uniqueTrimmedNames(servers.map((server) => server.name))) return false;
  return tools.every((tool) => isMcpToolValid(tool, mode)) && servers.every(isMcpServerValid);
}
