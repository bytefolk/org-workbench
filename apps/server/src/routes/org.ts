import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlPlaneContext } from "../context.js";
import { readJsonBody, sendJson } from "../http.js";
import { applyChangeManifest } from "../org/apply.js";

export async function handleOrgTree(
  ctx: ControlPlaneContext,
  res: ServerResponse,
): Promise<void> {
  sendJson(res, 200, ctx.workspace.snapshot());
}

export async function handleOrgApply(
  ctx: ControlPlaneContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rawBody = await readJsonBody<unknown>(req);
  const outcome = await applyChangeManifest(ctx, rawBody);
  sendJson(res, outcome.status, outcome.body);
}
