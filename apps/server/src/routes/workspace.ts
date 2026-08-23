import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceInfoResponse, WorkspaceOpenRequest } from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { readJsonBody, sendJson } from "../http.js";
import { OrgApiError, errorCodes } from "@org-workbench/shared";

export async function handleWorkspaceGet(
  ctx: ControlPlaneContext,
  res: ServerResponse,
): Promise<void> {
  const ws = ctx.workspace.active;
  const body: WorkspaceInfoResponse = ws
    ? {
        open: true,
        path: ws.dir,
        business: ws.organization.business,
        owner: ws.organization.owner,
        version: ws.version,
      }
    : { open: false };
  sendJson(res, 200, body);
}

export async function handleWorkspaceOpen(
  ctx: ControlPlaneContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<Partial<WorkspaceOpenRequest>>(req);
  if (typeof body.path !== "string" || body.path.length === 0) {
    throw new OrgApiError(errorCodes.body_invalid, 400, "path must be a non-empty string");
  }
  const ws = await ctx.workspace.openWorkspace(body.path);
  const version = ctx.workspace.touch();
  ctx.bus.publish("org.updated", {
    workspace: ws.dir,
    version,
    changes: [],
  });
  sendJson(res, 200, {
    open: true,
    path: ws.dir,
    business: ws.organization.business,
    owner: ws.organization.owner,
    version: ws.version,
  });
}
