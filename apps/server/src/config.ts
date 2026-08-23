import fs from "node:fs";
import { createBootToken } from "./auth.js";

export interface ServerConfig {
  /** Loopback only, always. The control plane never binds another interface. */
  host: "127.0.0.1";
  /** 0 = ephemeral port (shell reads the actual port from the ready line). */
  port: number;
  token: string;
  /** Pinned digital-employee CLI command consumed via spawn. */
  cliCommand: string;
  serverVersion: string;
}

export function resolveServerConfig(
  env: NodeJS.ProcessEnv,
  argv: string[],
): ServerConfig {
  let port = 0;
  const argPortIndex = argv.indexOf("--port");
  const rawPort = argPortIndex >= 0 ? argv[argPortIndex + 1] : env.ORG_WORKBENCH_SERVER_PORT;
  if (rawPort !== undefined) {
    const parsed = Number.parseInt(String(rawPort), 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 65535) port = parsed;
  }
  const envToken = env.ORG_WORKBENCH_BOOT_TOKEN;
  const token =
    typeof envToken === "string" && envToken.length >= 16 ? envToken : createBootToken();
  const cliCommand = env.ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI ?? "digital-employee";
  return { host: "127.0.0.1", port, token, cliCommand, serverVersion: readServerVersion() };
}

function readServerVersion(): string {
  try {
    const raw = fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
