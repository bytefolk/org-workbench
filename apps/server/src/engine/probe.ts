import { spawn } from "node:child_process";

export interface EngineProbe {
  available: boolean;
  version?: string;
  /** Actionable next step when unavailable — "failure still has a path". */
  nextStep?: string;
}

/**
 * Split a configured command like `node <repo>/bin.js` into argv parts.
 *
 * The naive `command.split(/\s+/)` failed on any absolute path containing a
 * space — Windows default installs under `C:\Program Files\...`, macOS
 * `~/OneDrive - Company/...`, Linux `~/My Projects/...` — turning one binary
 * into three broken tokens (org-workbench#78). This parser accepts POSIX-style
 * double and single quotes and Windows backslash escapes so an operator can
 * write either of the following without further wiring:
 *
 *   `"C:\Program Files\Node\node.exe" C:\my\path\to\bin.js`
 *   `/usr/local/bin/node "/home/me/My Projects/bin.js"`
 *
 * Unquoted whitespace still separates tokens; consecutive whitespace collapses.
 * When no quoting is present the result is identical to the previous
 * whitespace-only split, so downstream drivers (driver-cli / adapter-cli) and
 * existing tests stay bit-for-bit compatible.
 */
export function splitCommand(command: string): { bin: string; prefix: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasCurrent = false;
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index]!;
    if (quote) {
      if (ch === "\\" && quote === '"' && index + 1 < command.length) {
        const next = command[index + 1]!;
        if (next === '"' || next === "\\") {
          current += next;
          hasCurrent = true;
          index += 1;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      hasCurrent = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCurrent = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasCurrent) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }
    current += ch;
    hasCurrent = true;
  }
  if (hasCurrent) tokens.push(current);
  if (tokens.length === 0) return { bin: command, prefix: [] };
  const [bin, ...prefix] = tokens;
  return { bin: bin!, prefix };
}

interface RunOutcome {
  code: number | null;
  out: string;
  /** Set when the OS refused to launch the process at all. */
  launchError?: NodeJS.ErrnoException;
  /** Set when the process launched but the probe timed out. */
  timedOut?: boolean;
}

function runOnce(bin: string, args: string[], timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RunOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ code: null, out: "", launchError: error as NodeJS.ErrnoException });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, out: "", timedOut: true });
    }, timeoutMs);
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ code: null, out, launchError: error as NodeJS.ErrnoException });
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

  // Distinguish "OS refused to launch this binary" from "launched but broken",
  // so an operator no longer sees a single "not reachable" for both.
  const reason = classifyProbeFailure(versionRun, helpRun);
  return {
    available: false,
    nextStep: `pinned digital-employee CLI not reachable (command: ${command}). ${reason} Install it (or set ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI to the pinned entrypoint, e.g. "node <repo>/digital-employee/dist/apps/cli/bin.js").`,
  };
}

function classifyProbeFailure(versionRun: RunOutcome, helpRun: RunOutcome): string {
  const launchError = versionRun.launchError ?? helpRun.launchError;
  if (launchError) {
    if (launchError.code === "ENOENT") {
      return "The OS could not find the executable (ENOENT). If the path contains spaces, wrap it in double quotes.";
    }
    if (launchError.code === "EACCES") {
      return "The executable is not accessible (EACCES). Check file permissions or PATHEXT on Windows.";
    }
    return `The executable could not be launched (${launchError.code ?? "spawn error"}: ${launchError.message ?? "unknown"}).`;
  }
  if (versionRun.timedOut || helpRun.timedOut) {
    return "The executable was launched but did not respond within the probe timeout.";
  }
  return "The executable was launched but exited with a non-zero status or produced no recognisable version output.";
}
