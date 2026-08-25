import { spawnSync } from "node:child_process";
import type { ServerResponse } from "node:http";
import type { HealthResponse } from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { probeEngine } from "../engine/probe.js";
import { sendJson } from "../http.js";

/** Mirrors digital-employee's claude-local model port (#184): >= 2.1.214, < 2.2.0. */
const CLAUDE_VERSION_MIN = [2, 1, 214] as const;
const CLAUDE_VERSION_MAX = [2, 2, 0] as const;

export interface ClaudeLocalBinaryState {
  installed: boolean;
  version: string | null;
  supported: boolean;
}

function compareParts(parts: readonly [number, number, number], bound: readonly [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (parts[index]! < bound[index]!) return -1;
    if (parts[index]! > bound[index]!) return 1;
  }
  return 0;
}

export function supportedClaudeVersion(announced: string | null): boolean {
  if (announced === null) return false;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(announced);
  if (!match) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return false;
  return compareParts(parts, CLAUDE_VERSION_MIN) >= 0 && compareParts(parts, CLAUDE_VERSION_MAX) < 0;
}

/**
 * Local preflight for the claude-local Host. Only checks the binary and its
 * announced version — login state is asserted by the engine at run time from
 * the announced apiKeySource, so no credential store is ever inspected.
 */
export function probeClaudeLocalBinary(env: NodeJS.ProcessEnv, timeoutMs = 3000): ClaudeLocalBinaryState {
  const command = (env.DIGITAL_EMPLOYEE_CLAUDE_COMMAND ?? "").trim() || "claude";
  let probe: ReturnType<typeof spawnSync>;
  try {
    probe = spawnSync(command, ["--version"], { encoding: "utf8", timeout: timeoutMs, shell: false, windowsHide: true });
  } catch {
    return { installed: false, version: null, supported: false };
  }
  if (probe.error !== undefined || probe.status !== 0) {
    return { installed: false, version: null, supported: false };
  }
  const announced = typeof probe.stdout === "string" && probe.stdout.trim().length > 0
    ? probe.stdout
    : typeof probe.stderr === "string"
      ? probe.stderr
      : "";
  const match = /(\d+\.\d+\.\d+)/.exec(announced);
  const version = match ? match[1]! : null;
  return { installed: true, version, supported: supportedClaudeVersion(version) };
}

export function hostHealth(
  engineAvailable: boolean,
  env: NodeJS.ProcessEnv,
  claudeLocal: ClaudeLocalBinaryState = { installed: false, version: null, supported: false },
): HealthResponse["hosts"] {
  const qoderConfigured = typeof env.QODER_PERSONAL_ACCESS_TOKEN === "string" && env.QODER_PERSONAL_ACCESS_TOKEN.length > 0;
  const claudeConfigured = typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
  const claudeLocalConfigured = claudeLocal.installed && claudeLocal.supported;
  return {
    qoder: {
      configured: qoderConfigured,
      ready: engineAvailable && qoderConfigured,
      ...(!qoderConfigured
        ? { nextStep: "设置 QODER_PERSONAL_ACCESS_TOKEN 后重启工作台" }
        : !engineAvailable
          ? { nextStep: "先安装或配置支持 turn run 的 digital-employee CLI" }
          : {}),
    },
    "claude-code": {
      configured: claudeConfigured,
      ready: engineAvailable && claudeConfigured,
      ...(!claudeConfigured
        ? { nextStep: "设置 ANTHROPIC_API_KEY 后重启工作台" }
        : !engineAvailable
          ? { nextStep: "先安装或配置支持 turn run 的 digital-employee CLI" }
          : {}),
    },
    "claude-local": {
      configured: claudeLocalConfigured,
      ready: engineAvailable && claudeLocalConfigured,
      ...(!claudeLocal.installed
        ? { nextStep: "安装 Claude Code 并确保 claude 在 PATH 上（或用 DIGITAL_EMPLOYEE_CLAUDE_COMMAND 指定二进制路径）" }
        : !claudeLocal.supported
          ? {
              nextStep: claudeLocal.version === null
                ? "Claude Code 版本无法解析；支持窗口为 >= 2.1.214 且 < 2.2.0"
                : `Claude Code 版本 ${claudeLocal.version} 不在支持窗口（>= 2.1.214 且 < 2.2.0）内，请升级或降级`,
            }
          : !engineAvailable
            ? { nextStep: "先安装或配置支持 turn run 的 digital-employee CLI" }
            : {}),
    },
  };
}

export async function handleHealth(ctx: ControlPlaneContext, res: ServerResponse): Promise<void> {
  const probe = await probeEngine(ctx.config.cliCommand);
  const claudeLocal = probeClaudeLocalBinary(process.env);
  const ws = ctx.workspace.active;
  const body: HealthResponse = {
    status: "ok",
    api: "v0",
    server: { version: ctx.config.serverVersion, pid: process.pid },
    engine: {
      command: ctx.config.cliCommand,
      available: probe.available,
      version: probe.version,
      nextStep: probe.nextStep,
    },
    hosts: hostHealth(probe.available, process.env, claudeLocal),
    workspace: ws ? { open: true, path: ws.dir } : { open: false },
  };
  sendJson(res, 200, body);
}
