import { spawn } from "node:child_process";
import type { OrgApplyDriver } from "@org-workbench/shared";
import { splitCommand } from "./probe.js";

type DriverOutcome = Awaited<ReturnType<OrgApplyDriver["apply"]>>;

const CAPABILITY_MISSING_PATTERN =
  /unknown command|unknown argument|invalid choice|unrecognized command|no such command|did you mean/i;

/**
 * Spawn-based driver for the pinned digital-employee CLI (ADR-0002).
 *
 * Contract: `digital-employee org apply <stagingDir> --json` prints a final
 * JSON status line ({status:"applied"} | {status:"failed",code,message}).
 * Validation lawfulness lives entirely in the engine; this driver only spawns,
 * parses, and classifies. Secrets never enter argv — env injection only.
 */
export class DigitalEmployeeCliDriver implements OrgApplyDriver {
  constructor(
    private readonly command: string,
    private readonly timeoutMs = 120_000,
  ) {}

  apply(stagingDir: string): Promise<DriverOutcome> {
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
        child = spawn(bin, [...prefix, "org", "apply", stagingDir, "--json"], {
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
        const jsonLine = [...out.split("\n")]
          .reverse()
          .find((line) => line.trim().startsWith("{"));
        if (jsonLine) {
          try {
            const parsed = JSON.parse(jsonLine) as {
              status?: unknown;
              code?: unknown;
              message?: unknown;
            };
            if (parsed.status === "applied") {
              finish({ status: "applied" });
              return;
            }
            finish({
              status: "failed",
              code: typeof parsed.code === "string" ? parsed.code : "engine_failed",
              message:
                typeof parsed.message === "string"
                  ? parsed.message
                  : "engine reported failure without a message",
              retryable: false,
            });
            return;
          } catch {
            // Fall through to exit-code classification below.
          }
        }
        if (code === 0) {
          finish({ status: "applied" });
          return;
        }
        if (CAPABILITY_MISSING_PATTERN.test(errOut)) {
          finish({
            status: "engine_capability_missing",
            message: `${this.command} does not provide "org apply" yet (digital-employee #157 slice V2 pending); the staging seam is ready and will be re-verified against the pinned release`,
          });
          return;
        }
        finish({
          status: "failed",
          code: "engine_failed",
          message: errOut.trim().slice(0, 500) || `engine exited with code ${String(code)}`,
          retryable: false,
        });
      });
    });
  }
}
