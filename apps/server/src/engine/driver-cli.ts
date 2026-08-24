import { spawn } from "node:child_process";
import type { EngineOrgApplySuccess, OrgApplyDriver } from "@org-workbench/shared";
import { splitCommand } from "./probe.js";

type DriverOutcome = Awaited<ReturnType<OrgApplyDriver["apply"]>>;

const CAPABILITY_MISSING_PATTERN =
  /unknown command|unknown argument|invalid choice|unrecognized command|no such command|did you mean/i;

/**
 * Spawn-based driver for the pinned digital-employee CLI (ADR-0002).
 *
 * Contract: `digital-employee org apply <workspace> --json` prints one JSON
 * document ({status:"applied",...} | {status:"failed",code}).
 * Validation lawfulness lives entirely in the engine; this driver only spawns,
 * parses, and classifies. Secrets never enter argv — env injection only.
 */
export class DigitalEmployeeCliDriver implements OrgApplyDriver {
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
