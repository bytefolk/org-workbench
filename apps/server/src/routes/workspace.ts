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
  await resumeContextExports(ctx, ws.dir).catch(() => {
    // Workspace open remains independent from Context availability. A later
    // open/restart retries export intents without invoking any Host turn.
  });
  sendJson(res, 200, {
    open: true,
    path: ws.dir,
    business: ws.organization.business,
    owner: ws.organization.owner,
    version: ws.version,
  });
}

async function resumeContextExports(ctx: ControlPlaneContext, workspace: string): Promise<void> {
  const roles = ctx.workspace.requireOpen().organization.roles;
  for (const role of roles) {
    const sessions = await ctx.sessionStore.list(workspace, role.id);
    for (const session of sessions.sessions) {
      const history = await ctx.turnStore.sessionHistory(
        workspace,
        session.sessionId,
        session.positionId,
        new Date().toISOString(),
      );
      for (const turn of history.turns) {
        if (turn.status === "completed") {
          await ctx.contextExporter.enqueueCompletedTurn(workspace, session, turn);
        }
      }
    }
  }
}
