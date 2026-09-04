import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { splitCommand } from "../engine/probe.js";
import type { ContextAdapterClient, ContextOccurrence } from "./exporter.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const PROCESS_KILL_GRACE_MS = 250;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

class ContextAdapterProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextAdapterProcessError";
  }
}

export class ContextCliAdapterClient implements ContextAdapterClient {
  constructor(
    private readonly command: string,
    private readonly sourceEnvironment: NodeJS.ProcessEnv,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async ingest(occurrence: ContextOccurrence): Promise<{
    inserted: boolean;
    occurrenceId: string;
    status: "pending" | "done" | "failed";
  }> {
    const response = await this.execute("ingest", occurrence);
    if (
      !isRecord(response) || !exactKeys(response, ["inserted", "occurrenceId", "status"]) ||
      typeof response.inserted !== "boolean" || typeof response.occurrenceId !== "string" ||
      !SHA256_PATTERN.test(response.occurrenceId) ||
      (response.status !== "pending" && response.status !== "done" && response.status !== "failed")
    ) {
      throw new ContextAdapterProcessError("context adapter returned an invalid ingest response");
    }
    return {
      inserted: response.inserted,
      occurrenceId: response.occurrenceId,
      status: response.status,
    };
  }

  async distill(occurrenceId: string): Promise<{
    occurrenceId: string;
    status: "done";
    artifacts: number;
  }> {
    const response = await this.execute("distill", { occurrenceId });
    if (
      !isRecord(response) || !exactKeys(response, ["occurrenceId", "status", "artifacts"]) ||
      typeof response.occurrenceId !== "string" || !SHA256_PATTERN.test(response.occurrenceId) ||
      response.status !== "done" || !Number.isSafeInteger(response.artifacts) ||
      (response.artifacts as number) < 0
    ) {
      throw new ContextAdapterProcessError("context adapter returned an invalid distill response");
    }
    return {
      occurrenceId: response.occurrenceId,
      status: "done",
      artifacts: response.artifacts as number,
    };
  }

  private execute(command: "ingest" | "distill", request: unknown): Promise<unknown> {
    const requestText = JSON.stringify(request);
    return new Promise((resolve, reject) => {
      const { bin, prefix } = splitCommand(this.command);
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(bin, [...prefix, "adapter", command], {
          stdio: ["pipe", "pipe", "pipe"],
          env: contextAdapterEnvironment(this.sourceEnvironment),
        });
      } catch {
        reject(new ContextAdapterProcessError("context adapter is unavailable"));
        return;
      }
      let settled = false;
      let output = "";
      let outputBytes = 0;
      let diagnosticBytes = 0;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const finishReject = (): void => {
        if (settled) return;
        settled = true;
        reject(new ContextAdapterProcessError("context adapter request failed"));
      };
      const terminateChild = (): void => {
        child.kill("SIGTERM");
        if (forceKillTimer !== undefined) return;
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), PROCESS_KILL_GRACE_MS);
        forceKillTimer.unref();
      };
      const timer = setTimeout(() => {
        terminateChild();
        finishReject();
      }, this.timeoutMs);
      timer.unref();
      child.stdout!.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_RESPONSE_BYTES) {
          terminateChild();
          finishReject();
          return;
        }
        output += stdoutDecoder.write(chunk);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        // Drain bounded diagnostics so a child cannot block. The text is never
        // returned, persisted, or logged because it may include local details.
        diagnosticBytes += chunk.byteLength;
        if (diagnosticBytes <= MAX_DIAGNOSTIC_BYTES) stderrDecoder.write(chunk);
      });
      child.on("error", () => {
        clearTimeout(timer);
        if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
        finishReject();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
        if (settled) return;
        output += stdoutDecoder.end();
        stderrDecoder.end();
        if (code !== 0 || outputBytes > MAX_RESPONSE_BYTES) {
          finishReject();
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(output) as unknown;
        } catch {
          finishReject();
          return;
        }
        settled = true;
        resolve(parsed);
      });
      child.stdin!.on("error", () => {
        terminateChild();
        finishReject();
      });
      child.stdin!.end(requestText, "utf8");
    });
  }
}

/** Minimal process environment: runtime token and vault remain server-only. */
function contextAdapterEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const target: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "SHELL"] as const) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  for (const key of ["CONTEXT_VAULT", "CONTEXT_RUNTIME_TOKEN"] as const) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
