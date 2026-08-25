import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type {
  EngineOrgApplySuccess,
  EngineEvent,
  OrgApplyDriver,
  TurnEngine,
  TurnRunDriver,
  TurnRunRequest,
  TurnRunResult,
  TurnTerminalReason,
} from "@org-workbench/shared";
import { splitCommand } from "./probe.js";

type DriverOutcome = Awaited<ReturnType<OrgApplyDriver["apply"]>>;

const CAPABILITY_MISSING_PATTERN =
  /unknown command|unknown argument|invalid choice|unrecognized command|no such command|did you mean/i;

// digital-employee 0c4cd54 bounds the Host model string at 1,048,576
// characters. JSON may encode one character as a six-byte escape, and the
// engine emits the model text once as a delta and once in its terminal.
const ENGINE_MODEL_MAX_CHARACTERS = 1_048_576;
const MAX_ESCAPED_MODEL_BYTES = ENGINE_MODEL_MAX_CHARACTERS * 6 + 2;
const MAX_TURN_LINE_BYTES = MAX_ESCAPED_MODEL_BYTES + 64 * 1024;
const MAX_TURN_OUTPUT_BYTES = MAX_TURN_LINE_BYTES * 2 + 256 * 1024;
const MAX_TURN_EVENTS = 4_096;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const MAX_TERMINAL_OUTPUT_BYTES = MAX_ESCAPED_MODEL_BYTES;
const PROCESS_KILL_GRACE_MS = 250;
const ENGINE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TERMINAL_REASONS = new Set<TurnTerminalReason>([
  "goal_met",
  "invalid_output_exhausted",
  "turn_budget_exceeded",
  "position_budget_exceeded",
  "iteration_cap",
  "doom_loop",
  "deadline_exceeded",
  "cancelled",
  "engine_internal_error",
]);

class EngineProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new EngineProtocolError("engine.v1 event fields do not match the frozen shape");
  }
}

function boundedJsonBytes(value: unknown, limit: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= limit;
  } catch {
    return false;
  }
}

function boundedCodePoints(value: string, limit: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > limit) return false;
  }
  return true;
}

function stableSpawnCode(diagnostic: string): string | null {
  const match = /^(?:digital-employee:\s+)?([a-z0-9][a-z0-9._-]{0,127}):/m.exec(
    diagnostic,
  );
  const code = match?.[1];
  if (code?.startsWith("engine.") || code?.startsWith("workspace_org_")) return code;
  return null;
}

function baseEvent(raw: Record<string, unknown>): { runId: string; timestamp: string } {
  if (typeof raw.runId !== "string" || raw.runId.length < 1 || raw.runId.length > 256) {
    throw new EngineProtocolError("engine.v1 runId is invalid");
  }
  if (typeof raw.timestamp !== "string" || Number.isNaN(Date.parse(raw.timestamp))) {
    throw new EngineProtocolError("engine.v1 timestamp is invalid");
  }
  return { runId: raw.runId, timestamp: raw.timestamp };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseEngineEvent(line: string): EngineEvent {
  let unknownEvent: unknown;
  try {
    unknownEvent = JSON.parse(line) as unknown;
  } catch {
    throw new EngineProtocolError("engine stdout contains non-JSON data");
  }
  if (!isRecord(unknownEvent) || typeof unknownEvent.type !== "string") {
    throw new EngineProtocolError("engine stdout line is not an engine.v1 event");
  }
  const base = baseEvent(unknownEvent);
  switch (unknownEvent.type) {
    case "run.started":
      exactKeys(unknownEvent, ["type", "runId", "timestamp"]);
      return { ...base, type: "run.started" };
    case "model.delta":
      exactKeys(unknownEvent, ["type", "runId", "timestamp", "text"]);
      if (
        typeof unknownEvent.text !== "string" ||
        !boundedCodePoints(unknownEvent.text, ENGINE_MODEL_MAX_CHARACTERS)
      ) {
        throw new EngineProtocolError("engine.v1 model.delta text is invalid or unbounded");
      }
      return { ...base, type: "model.delta", text: unknownEvent.text };
    case "usage": {
      exactKeys(
        unknownEvent,
        ["type", "runId", "timestamp"],
        ["inputTokens", "outputTokens", "totalTokens"],
      );
      for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
        if (unknownEvent[key] !== undefined && !nonNegativeInteger(unknownEvent[key])) {
          throw new EngineProtocolError(`engine.v1 usage.${key} is invalid`);
        }
      }
      return {
        ...base,
        type: "usage",
        ...(unknownEvent.inputTokens !== undefined
          ? { inputTokens: unknownEvent.inputTokens as number }
          : {}),
        ...(unknownEvent.outputTokens !== undefined
          ? { outputTokens: unknownEvent.outputTokens as number }
          : {}),
        ...(unknownEvent.totalTokens !== undefined
          ? { totalTokens: unknownEvent.totalTokens as number }
          : {}),
      };
    }
    case "run.completed":
      exactKeys(unknownEvent, ["type", "runId", "timestamp", "output", "terminalReason"]);
      if (
        unknownEvent.terminalReason !== "goal_met" ||
        !boundedJsonBytes(unknownEvent.output, MAX_TERMINAL_OUTPUT_BYTES)
      ) {
        throw new EngineProtocolError("engine.v1 run.completed is invalid or unbounded");
      }
      return {
        ...base,
        type: "run.completed",
        output: unknownEvent.output,
        terminalReason: "goal_met",
      };
    case "run.failed": {
      exactKeys(unknownEvent, ["type", "runId", "timestamp", "error"]);
      if (!isRecord(unknownEvent.error)) {
        throw new EngineProtocolError("engine.v1 run.failed error is invalid");
      }
      exactKeys(unknownEvent.error, ["code", "message", "retryable", "terminalReason"]);
      if (
        typeof unknownEvent.error.code !== "string" ||
        !ENGINE_CODE_PATTERN.test(unknownEvent.error.code) ||
        typeof unknownEvent.error.message !== "string" ||
        Buffer.byteLength(unknownEvent.error.message, "utf8") > MAX_DIAGNOSTIC_BYTES ||
        typeof unknownEvent.error.retryable !== "boolean" ||
        !TERMINAL_REASONS.has(unknownEvent.error.terminalReason as TurnTerminalReason)
      ) {
        throw new EngineProtocolError("engine.v1 run.failed error fields are invalid");
      }
      return {
        ...base,
        type: "run.failed",
        error: {
          code: unknownEvent.error.code,
          message: unknownEvent.error.message,
          retryable: unknownEvent.error.retryable,
          terminalReason: unknownEvent.error.terminalReason as TurnTerminalReason,
        },
      };
    }
    default:
      throw new EngineProtocolError(`unsupported engine.v1 event type: ${unknownEvent.type}`);
  }
}

function turnEnvironment(engine: TurnEngine): NodeJS.ProcessEnv {
  const source = process.env;
  const allowed = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "SHELL"] as const;
  const environment: NodeJS.ProcessEnv = {
    DIGITAL_EMPLOYEE_ENGINE_MODEL: engine,
  };
  for (const key of allowed) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  if (engine === "qoder") {
    if (source.QODER_PERSONAL_ACCESS_TOKEN !== undefined) environment.QODER_PERSONAL_ACCESS_TOKEN = source.QODER_PERSONAL_ACCESS_TOKEN;
  } else if (engine === "claude-code") {
    if (source.ANTHROPIC_API_KEY !== undefined) environment.ANTHROPIC_API_KEY = source.ANTHROPIC_API_KEY;
  } else {
    // claude-local runs on the operator's logged-in Claude Code; it must not
    // receive a service credential. DIGITAL_EMPLOYEE_CLAUDE_COMMAND only
    // overrides which local binary the engine port spawns.
    if (source.DIGITAL_EMPLOYEE_CLAUDE_COMMAND !== undefined) {
      environment.DIGITAL_EMPLOYEE_CLAUDE_COMMAND = source.DIGITAL_EMPLOYEE_CLAUDE_COMMAND;
    }
  }
  return environment;
}

/**
 * Spawn-based driver for the pinned digital-employee CLI (ADR-0002).
 *
 * Contract: `digital-employee org apply <workspace> --json` prints one JSON
 * document ({status:"applied",...} | {status:"failed",code}).
 * Validation lawfulness lives entirely in the engine; this driver only spawns,
 * parses, and classifies. Secrets never enter argv — env injection only.
 */
export class DigitalEmployeeCliDriver implements OrgApplyDriver, TurnRunDriver {
  constructor(
    private readonly command: string,
    private readonly timeoutMs = 120_000,
  ) {}

  apply(workspaceDir: string): Promise<DriverOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: DriverOutcome): void => {
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };
      const { bin, prefix } = splitCommand(this.command);
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(bin, [...prefix, "org", "apply", workspaceDir, "--json"], {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
      } catch {
        finish({
          status: "engine_unavailable",
          message: `cannot spawn ${this.command}`,
        });
        return;
      }
      let out = "";
      let errOut = "";
      const timer = setTimeout(() => {
        child.kill();
        finish({
          status: "engine_unavailable",
          message: `digital-employee org apply timed out after ${this.timeoutMs}ms`,
        });
      }, this.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        out += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        errOut += String(chunk);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish({
          status: "engine_unavailable",
          message: `cannot spawn ${this.command} (ENOENT); set ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI to the pinned CLI`,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const parsedOutput = parseJsonOutput(out);
        if (parsedOutput !== null) {
          try {
            const parsed = parsedOutput as {
              status?: unknown;
              code?: unknown;
              message?: unknown;
            };
            if (parsed.status === "applied") {
              if (!isAppliedResult(parsedOutput)) {
                finish({
                  status: "failed",
                  code: "engine_failed",
                  message: "engine returned an invalid applied payload",
                  retryable: false,
                });
                return;
              }
              finish({ status: "applied", result: parsedOutput });
              return;
            }
            if (parsed.status === "failed") {
              finish({
                status: "failed",
                code: typeof parsed.code === "string" ? parsed.code : "engine_failed",
                message:
                  typeof parsed.message === "string"
                    ? parsed.message
                    : typeof parsed.code === "string"
                      ? parsed.code
                      : "engine reported failure without a stable code",
                retryable: false,
              });
              return;
            }
          } catch {
            // Fall through to exit-code classification below.
          }
        }
        if (CAPABILITY_MISSING_PATTERN.test(errOut)) {
          finish({
            status: "engine_capability_missing",
            message: `${this.command} does not provide "org apply"; install a digital-employee build with the directory-driven org contract`,
          });
          return;
        }
        finish({
          status: "failed",
          code: "engine_failed",
          message:
            errOut.trim().slice(0, 500) ||
            `engine exited with code ${String(code)} without a valid status payload`,
          retryable: false,
        });
      });
    });
  }

  turnRun(request: TurnRunRequest): Promise<TurnRunResult> {
    return new Promise((resolve) => {
      let settled = false;
      let acceptingOutput = true;
      let timedOut = false;
      let child: ReturnType<typeof spawn> | undefined;
      let stdoutBuffer = "";
      let stdoutBytes = 0;
      let diagnostic = "";
      let protocolError: string | null = null;
      let runId: string | null = null;
      let started = false;
      let terminal = false;
      const events: EngineEvent[] = [];
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let forceKillTimer: NodeJS.Timeout | undefined;

      const finish = (result: TurnRunResult): void => {
        if (settled) return;
        settled = true;
        acceptingOutput = false;
        resolve({ ...result, events: [...result.events] });
      };
      const terminateChild = (): void => {
        child?.kill("SIGTERM");
        if (forceKillTimer !== undefined) return;
        forceKillTimer = setTimeout(() => {
          child?.kill("SIGKILL");
        }, PROCESS_KILL_GRACE_MS);
        forceKillTimer.unref();
      };
      const failProtocol = (message: string): void => {
        if (protocolError !== null) return;
        protocolError = message;
        acceptingOutput = false;
        stdoutBuffer = "";
        terminateChild();
      };
      const consumeLine = (line: string): void => {
        if (!acceptingOutput || settled) return;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length === 0 || protocolError !== null) return;
        if (Buffer.byteLength(line, "utf8") > MAX_TURN_LINE_BYTES) {
          failProtocol("engine.v1 line exceeds the bounded size");
          return;
        }
        try {
          const event = parseEngineEvent(line);
          if (events.length >= MAX_TURN_EVENTS) {
            throw new EngineProtocolError("engine.v1 stream exceeds the bounded event count");
          }
          if (!started && event.type !== "run.started") {
            throw new EngineProtocolError("engine.v1 stream must start with run.started");
          }
          if (started && event.type === "run.started") {
            throw new EngineProtocolError("engine.v1 stream contains multiple run.started events");
          }
          if (terminal) {
            throw new EngineProtocolError("engine.v1 stream contains an event after its terminal");
          }
          if (runId !== null && event.runId !== runId) {
            throw new EngineProtocolError("engine.v1 stream changes runId");
          }
          runId = event.runId;
          if (event.type === "run.started") started = true;
          if (event.type === "run.completed" || event.type === "run.failed") terminal = true;
          events.push(event);
          // A terminal is trusted only after the child exits 0. Buffer it
          // until close so an exit-1 process can never emit a false terminal
          // onto the control-plane SSE stream.
          if (event.type !== "run.completed" && event.type !== "run.failed") {
            request.onEvent?.(event);
          }
        } catch (error) {
          failProtocol(error instanceof Error ? error.message : "invalid engine.v1 event");
        }
      };

      const { bin, prefix } = splitCommand(this.command);
      try {
        child = spawn(
          bin,
          [...prefix, "turn", "run", request.workspace, "--position", request.positionId, "--stdin"],
          {
            stdio: ["pipe", "pipe", "pipe"],
            env: turnEnvironment(request.engine),
          },
        );
      } catch {
        finish({
          status: "indeterminate",
          events,
          diagnostic: "",
          code: "turn_engine_unavailable",
        });
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        acceptingOutput = false;
        stdoutBuffer = "";
        terminateChild();
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (!acceptingOutput || settled) return;
        stdoutBytes += Buffer.isBuffer(chunk)
          ? chunk.byteLength
          : Buffer.byteLength(chunk, "utf8");
        if (stdoutBytes > MAX_TURN_OUTPUT_BYTES) {
          failProtocol("engine.v1 stream exceeds the bounded output size");
          return;
        }
        const text = Buffer.isBuffer(chunk) ? stdoutDecoder.write(chunk) : chunk;
        stdoutBuffer += text;
        let newline = stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline);
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          consumeLine(line);
          newline = stdoutBuffer.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (!acceptingOutput || settled) return;
        if (Buffer.byteLength(diagnostic, "utf8") >= MAX_DIAGNOSTIC_BYTES) return;
        const remaining = MAX_DIAGNOSTIC_BYTES - Buffer.byteLength(diagnostic, "utf8");
        const text = Buffer.isBuffer(chunk) ? stderrDecoder.write(chunk) : chunk;
        diagnostic += Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
      });
      child.on("error", () => {
        clearTimeout(timer);
        if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
        finish({
          status: "indeterminate",
          events,
          diagnostic: "",
          code: "turn_engine_unavailable",
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
        if (settled) return;
        if (timedOut) {
          finish({
            status: "indeterminate",
            events,
            diagnostic,
            code: "turn_timeout",
          });
          return;
        }
        if (acceptingOutput) {
          stdoutBuffer += stdoutDecoder.end();
          if (Buffer.byteLength(diagnostic, "utf8") < MAX_DIAGNOSTIC_BYTES) {
            const remaining = MAX_DIAGNOSTIC_BYTES - Buffer.byteLength(diagnostic, "utf8");
            diagnostic += Buffer.from(stderrDecoder.end(), "utf8")
              .subarray(0, remaining)
              .toString("utf8");
          }
          if (stdoutBuffer.length > 0) consumeLine(stdoutBuffer);
        }
        if (protocolError !== null) {
          finish({
            status: "indeterminate",
            events,
            diagnostic: "engine output violated engine.v1",
            code: "turn_protocol_invalid",
          });
          return;
        }
        if (code !== 0) {
          finish({
            status: "indeterminate",
            events,
            diagnostic,
            code:
              code === 1
                ? (stableSpawnCode(diagnostic) ?? "turn_process_exit_1")
                : "turn_process_failed",
          });
          return;
        }
        if (!started || !terminal) {
          finish({
            status: "indeterminate",
            events,
            diagnostic: "engine output ended without exactly one trusted terminal",
            code: "turn_protocol_invalid",
          });
          return;
        }
        request.onEvent?.(events[events.length - 1]!);
        finish({ status: "trusted", events, diagnostic });
      });
      child.stdin?.on("error", () => {
        // close/error classification remains authoritative; EPIPE is expected
        // when the child rejects before consuming the envelope.
      });
      child.stdin?.end(JSON.stringify(request.envelope));
    });
  }
}

function parseJsonOutput(output: string): unknown | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const line = [...trimmed.split("\n")]
      .reverse()
      .find((candidate) => candidate.trim().startsWith("{"));
    if (!line) return null;
    try {
      return JSON.parse(line) as unknown;
    } catch {
      return null;
    }
  }
}

function isAppliedResult(value: unknown): value is EngineOrgApplySuccess {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  const changes = result.changes;
  if (typeof changes !== "object" || changes === null) return false;
  const changeSet = changes as Record<string, unknown>;
  return (
    result.status === "applied" &&
    typeof result.business === "string" &&
    typeof result.owner === "string" &&
    typeof result.bootstrapped === "boolean" &&
    Number.isInteger(result.positions) &&
    Array.isArray(changeSet.hired) &&
    Array.isArray(changeSet.moved) &&
    Array.isArray(changeSet.dismissed) &&
    Array.isArray(changeSet.budgetUpdated) &&
    typeof result.organization === "string" &&
    typeof result.audit === "string" &&
    typeof result.permissions === "string"
  );
}
