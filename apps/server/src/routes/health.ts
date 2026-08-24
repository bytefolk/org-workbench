import type { ServerResponse } from "node:http";
import type { HealthResponse } from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { probeEngine } from "../engine/probe.js";
import { sendJson } from "../http.js";

export function hostHealth(
  engineAvailable: boolean,
  env: NodeJS.ProcessEnv,
): HealthResponse["hosts"] {
  const qoderConfigured = typeof env.QODER_PERSONAL_ACCESS_TOKEN === "string" && env.QODER_PERSONAL_ACCESS_TOKEN.length > 0;
  const claudeConfigured = typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
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
  };
}

export async function handleHealth(ctx: ControlPlaneContext, res: ServerResponse): Promise<void> {
  const probe = await probeEngine(ctx.config.cliCommand);
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
    hosts: hostHealth(probe.available, process.env),
    workspace: ws ? { open: true, path: ws.dir } : { open: false },
  };
  sendJson(res, 200, body);
}
