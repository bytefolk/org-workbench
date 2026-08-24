import crypto from "node:crypto";
import type { TurnEnvelope } from "@org-workbench/shared";
import { TURN_ENVELOPE_SCHEMA_VERSION } from "@org-workbench/shared";

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Exact mirror of digital-employee computeEnvelopeDigest at 0c4cd54. */
export function computeEnvelopeDigest(body: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalJson(body));
  return `sha256:${crypto.createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function createTurnEnvelope(input: {
  workspaceRef: string;
  positionId: string;
  turnId: string;
  message: string;
}): TurnEnvelope {
  const body = {
    schemaVersion: TURN_ENVELOPE_SCHEMA_VERSION,
    workspaceRef: input.workspaceRef,
    positionId: input.positionId,
    turnId: input.turnId,
    input: input.message,
  };
  return { ...body, envelopeDigest: computeEnvelopeDigest(body) };
}
