import { spawn } from "node:child_process";

export interface EngineProbe {
  available: boolean;
  version?: string;
  /** Actionable next step when unavailable — "failure still has a path". */
  nextStep?: string;
}

/** Split a configured command like "node <repo>/bin.js" into argv parts. */
export function splitCommand(command: string): { bin: string; prefix: string[] } {
  const parts = command.split(/\s+/).filter((part) => part.length > 0);
  const bin = parts.shift() ?? command;
  return { bin, prefix: parts };
}

function runOnce(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { code: number | null; out: string }): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      finish({ code: null, out: "" });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, out: "" });
    }, timeoutMs);
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish({ code: null, out: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, out });
    });
  });
}

/**
 * Probe the pinned digital-employee CLI for GET /health (ADR-0002).
 *
 * Strategy: `<command> --version` first; commander-style builds answer
 * `--help` instead, so fall back to it and extract a semver when present.
 * Version stays optional — availability is the contracted signal.
 */
export async function probeEngine(command: string, timeoutMs = 5000): Promise<EngineProbe> {
  const { bin, prefix } = splitCommand(command);

  const versionRun = await runOnce(bin, [...prefix, "--version"], timeoutMs);
  if (versionRun.code === 0 && versionRun.out.trim().length > 0) {
    const lines = versionRun.out.trim().split("\n");
    return { available: true, version: lines[lines.length - 1] };
  }

  const helpRun = await runOnce(bin, [...prefix, "--help"], timeoutMs);
  if (helpRun.code === 0) {
    const semver = /\d+\.\d+\.\d+/.exec(helpRun.out) ?? /\d+\.\d+\.\d+/.exec(versionRun.out);
    return semver ? { available: true, version: semver[0] } : { available: true };
  }

  return {
    available: false,
    nextStep: `pinned digital-employee CLI not reachable (command: ${command}). Install it (or set ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI to the pinned entrypoint, e.g. "node <repo>/digital-employee/dist/apps/cli/bin.js").`,
  };
}
