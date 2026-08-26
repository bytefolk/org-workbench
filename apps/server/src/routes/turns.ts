import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OrgApiError,
  errorCodes,
  turnEngines,
} from "@org-workbench/shared";
import type {
  EngineEvent,
  SseEventType,
  TurnEngine,
  TurnPendingApproval,
  TurnRecord,
  WorkbenchSession,
} from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { readJsonBody, sendJson } from "../http.js";
import { createTurnEnvelope } from "../turns/envelope.js";
import { assertPositionId } from "../turns/store.js";

const MAX_INPUT_BYTES = 256 * 1024;
// Mirrors the digital-employee #193 envelope first gate bounds
// (apps/cli/turn/envelope.ts: MAX_ID_LENGTH, MAX_APPROVAL_REASON_BYTES).
const MAX_APPROVAL_ID_LENGTH = 256;
const MAX_APPROVAL_REASON_BYTES = 1024;

export interface TurnPostBody {
  positionId: string;
  input: string;
  engine: TurnEngine;
  /** Operator verdict for a resume turn (#193); optional, additive. */
  pendingApproval?: TurnPendingApproval;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Required+optional key check mirroring driver-cli.ts exactKeys. */
function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Fail-closed boundary validation for the #193 verdict field, mirroring the
 * upstream envelope first gate; the engine remains the byte-exact backstop.
 */
export function assertPendingApproval(raw: unknown): TurnPendingApproval {
  if (!isRecord(raw)) {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval must be a JSON object");
  }
  if (!hasExactKeys(raw, ["approvalId", "decision", "decidedBy"], ["scope", "reason", "expiresAt"])) {
    throw new OrgApiError(
      errorCodes.turn_request_invalid,
      400,
      "pendingApproval accepts approvalId, decision, decidedBy plus optional scope, reason, expiresAt",
    );
  }
  if (
    typeof raw.approvalId !== "string" ||
    raw.approvalId.trim().length === 0 ||
    raw.approvalId.length > MAX_APPROVAL_ID_LENGTH
  ) {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval.approvalId is invalid");
  }
  if (raw.decision !== "granted" && raw.decision !== "denied") {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval.decision must be granted or denied");
  }
  if (raw.decidedBy !== "operator") {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval.decidedBy must be operator");
  }
  if (raw.scope !== undefined && raw.scope !== "once" && raw.scope !== "run") {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval.scope must be once or run when present");
  }
  if (
    raw.reason !== undefined &&
    (typeof raw.reason !== "string" ||
      raw.reason.trim().length === 0 ||
      Buffer.byteLength(raw.reason, "utf8") > MAX_APPROVAL_REASON_BYTES)
  ) {
    throw new OrgApiError(
      errorCodes.turn_request_invalid,
      400,
      "pendingApproval.reason must be a non-empty UTF-8 string no larger than 1024 bytes",
    );
  }
  if (raw.expiresAt !== undefined && (typeof raw.expiresAt !== "string" || Number.isNaN(Date.parse(raw.expiresAt)))) {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "pendingApproval.expiresAt must be a valid ISO 8601 timestamp");
  }
  return {
    approvalId: raw.approvalId,
    decision: raw.decision,
    decidedBy: "operator",
    ...(raw.scope !== undefined ? { scope: raw.scope } : {}),
    ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
    ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
  };
}

function parsePostBody(raw: unknown): TurnPostBody {
  if (!isRecord(raw)) {
    throw new OrgApiError(errorCodes.turn_request_invalid, 400, "turn request must be a JSON object");
  }
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "engine,input,positionId" && keys.join(",") !== "engine,input,pendingApproval,positionId") {
    throw new OrgApiError(
      errorCodes.turn_request_invalid,
      400,
      "turn request accepts exactly positionId, input, engine, and optional pendingApproval",
    );
  }
  const positionId = assertPositionId(raw.positionId);
  if (
    typeof raw.input !== "string" ||
    raw.input.trim().length === 0 ||
    Buffer.byteLength(raw.input, "utf8") > MAX_INPUT_BYTES
  ) {
    throw new OrgApiError(
      errorCodes.turn_request_invalid,
      400,
      "input must be a non-empty UTF-8 string no larger than 256 KiB",
    );
  }
  if (typeof raw.engine !== "string" || !turnEngines.includes(raw.engine as TurnEngine)) {
    throw new OrgApiError(
      errorCodes.turn_engine_unsupported,
      400,
      `engine must be ${turnEngines.join(" or ")}`,
    );
  }
  return {
    positionId,
    input: raw.input,
    engine: raw.engine as TurnEngine,
    ...(raw.pendingApproval !== undefined
      ? { pendingApproval: assertPendingApproval(raw.pendingApproval) }
      : {}),
  };
}

export function assertPositionExists(ctx: ControlPlaneContext, positionId: string): void {
  const workspace = ctx.workspace.requireOpen();
  if (!workspace.organization.roles.some((role) => role.id === positionId)) {
    throw new OrgApiError(errorCodes.position_missing, 404, `position not found: ${positionId}`);
  }
}

function eventType(event: EngineEvent): SseEventType {
  switch (event.type) {
    case "run.started":
      return "turn.started";
    case "model.delta":
      return "turn.model.delta";
    case "usage":
      return "turn.usage";
    case "run.completed":
      return "turn.completed";
    case "run.failed":
      return "turn.failed";
    case "approval.requested":
      return "turn.approval.requested";
    case "approval.granted":
      return "turn.approval.granted";
    case "approval.denied":
      return "turn.approval.denied";
  }
}

export async function handleTurnPost(
  ctx: ControlPlaneContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = parsePostBody(await readJsonBody<unknown>(req));
  assertPositionExists(ctx, body.positionId);
  await executeTurn(ctx, res, body);
}

/** Shared execution path. `sessionId` is server-resolved by SessionStore; it
 * never comes from a renderer-supplied position/principal mapping. */
export async function executeTurn(
  ctx: ControlPlaneContext,
  res: ServerResponse,
  body: TurnPostBody,
  session?: WorkbenchSession,
): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  const turnId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const envelope = createTurnEnvelope({
    workspaceRef: workspace.dir,
    positionId: body.positionId,
    turnId,
    message: body.input,
    ...(body.pendingApproval !== undefined
      ? { pendingApproval: body.pendingApproval }
      : {}),
  });
  const beginInput = {
    workspace: workspace.dir,
    positionId: body.positionId,
    turnId,
    engine: body.engine,
    message: body.input,
    envelopeDigest: envelope.envelopeDigest,
    now: createdAt,
  };
  const running = session === undefined
    ? await ctx.turnStore.begin(beginInput)
    : await ctx.turnStore.beginSession({ ...beginInput, sessionId: session.sessionId });

  let result;
  try {
    result = await ctx.turnDriver.turnRun({
      workspace: workspace.dir,
      positionId: body.positionId,
      engine: body.engine,
      envelope,
      // Stream progress immediately, but hold every terminal until the final
      // turn record has been durably replaced below.
      onEvent: (event) => {
        if (event.type !== "run.completed" && event.type !== "run.failed") {
          ctx.bus.publish(eventType(event), event);
        }
      },
      setAbort: (abort) => ctx.runningTurns.register(body.positionId, abort),
    });
  } catch {
    result = {
      status: "indeterminate" as const,
      events: [],
      diagnostic: "",
      code: "turn_driver_failure",
    };
  } finally {
    ctx.runningTurns.unregister(body.positionId);
  }

  const updatedAt = new Date().toISOString();
  let record: TurnRecord;
  if (result.status === "indeterminate") {
    record = {
      ...running,
      status: "indeterminate",
      updatedAt,
      events: result.events,
      ...(result.events[0] !== undefined ? { runId: result.events[0].runId } : {}),
      error: {
        code: result.code,
        message: "the engine process ended without a trusted terminal; no automatic retry was attempted",
        retryable: false,
      },
    };
  } else {
    const terminal = result.events[result.events.length - 1]!;
    if (terminal.type === "run.completed") {
      record = {
        ...running,
        status: "completed",
        updatedAt,
        events: result.events,
        runId: terminal.runId,
        output: terminal.output,
      };
    } else if (terminal.type === "run.failed") {
      record = {
        ...running,
        status: "failed",
        updatedAt,
        events: result.events,
        runId: terminal.runId,
        error: {
          code: terminal.error.code,
          message: terminal.error.message,
          retryable: terminal.error.retryable,
        },
      };
    } else {
      record = {
        ...running,
        status: "indeterminate",
        updatedAt,
        events: result.events,
        error: {
          code: "turn_protocol_invalid",
          message: "the validated event stream did not end in a terminal event",
          retryable: false,
        },
      };
    }
  }
  if (session === undefined) await ctx.turnStore.finish(workspace.dir, record);
  else await ctx.turnStore.finishSession(workspace.dir, session.sessionId, record);
  if (session !== undefined && record.status === "completed") {
    // The durable turn is authoritative. Export persistence/adapter failure is
    // intentionally isolated and will be retried by workspace-open recovery.
    try {
      await ctx.contextExporter.enqueueCompletedTurn(workspace.dir, session, record);
    } catch {
      // No raw adapter or turn content crosses into the HTTP response/report.
    }
  }
  if (record.status === "indeterminate") {
    ctx.bus.publish("turn.indeterminate", {
      turnId,
      positionId: body.positionId,
      code: record.error?.code ?? "turn_protocol_invalid",
      envelopeDigest: envelope.envelopeDigest,
    });
  } else {
    const terminal = result.events[result.events.length - 1];
    if (terminal?.type === "run.completed" || terminal?.type === "run.failed") {
      ctx.bus.publish(eventType(terminal), terminal);
    }
  }
  sendJson(res, 200, record);
}

export async function handleTurnHistory(
  ctx: ControlPlaneContext,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  const positionId = assertPositionId(url.searchParams.get("positionId"));
  assertPositionExists(ctx, positionId);
  const history = await ctx.turnStore.history(workspace.dir, positionId, new Date().toISOString());
  sendJson(res, 200, history);
}

/** Additive v0 route (issue #25): aborts the in-flight turn for a position.
 * The driver settles the turn as indeterminate/turn_cancelled through the
 * frozen turn.indeterminate vocabulary; no new SSE event is introduced. */
export async function handleTurnCancel(
  ctx: ControlPlaneContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const raw = await readJsonBody<unknown>(req);
  if (!isRecord(raw) || Object.keys(raw).length !== 1 || typeof raw.positionId !== "string") {
    throw new OrgApiError(
      errorCodes.turn_request_invalid,
      400,
      "cancel request accepts exactly {positionId}",
    );
  }
  const positionId = assertPositionId(raw.positionId);
  if (!ctx.runningTurns.cancel(positionId)) {
    throw new OrgApiError(errorCodes.not_found, 404, `no running turn: ${positionId}`);
  }
  sendJson(res, 200, { cancelled: true, positionId });
}
