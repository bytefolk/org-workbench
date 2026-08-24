import http from "node:http";
import { OrgApiError, errorCodes, routes } from "@org-workbench/shared";
import { bearerAuthorized } from "./auth.js";
import type { ControlPlaneContext } from "./context.js";
import { sendError, sendJson } from "./http.js";
import { handleEvents } from "./routes/events.js";
import { handleHealth } from "./routes/health.js";
import { handleOrgApply, handleOrgBackups, handleOrgRestore, handleOrgTree } from "./routes/org.js";
import { handlePositionGet } from "./routes/positions.js";
import { handleReports } from "./routes/reports.js";
import { handleTurnHistory, handleTurnPost } from "./routes/turns.js";
import { handleWorkspaceGet, handleWorkspaceOpen } from "./routes/workspace.js";

/**
 * Loopback-only control-plane HTTP server (frozen v0 contract).
 * Auth: every endpoint except /health requires `Authorization: Bearer <boot-token>`.
 */
export function createControlPlane(ctx: ControlPlaneContext): http.Server {
  return http.createServer((req, res) => {
    void dispatch(ctx, req, res);
  });
}

async function dispatch(
  ctx: ControlPlaneContext,
  req: IncomingMessageLike,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname !== routes.health && !bearerAuthorized(req, ctx.config.token)) {
      sendJson(
        res,
        401,
        new OrgApiError(errorCodes.unauthorized, 401, "missing or invalid bearer token").toBody(),
      );
      return;
    }

    if (pathname === routes.health && method === "GET") {
      await handleHealth(ctx, res);
      return;
    }
    if (pathname === routes.workspace && method === "GET") {
      await handleWorkspaceGet(ctx, res);
      return;
    }
    if (pathname === routes.workspaceOpen && method === "POST") {
      await handleWorkspaceOpen(ctx, req, res);
      return;
    }
    if (pathname === routes.orgTree && method === "GET") {
      await handleOrgTree(ctx, res);
      return;
    }
    if (pathname === routes.orgApply && method === "POST") {
      await handleOrgApply(ctx, req, res);
      return;
    }
    if (pathname === routes.orgBackups && method === "GET") {
      await handleOrgBackups(ctx, res);
      return;
    }
    if (pathname === routes.orgRestore && method === "POST") {
      await handleOrgRestore(ctx, req, res);
      return;
    }
    if (pathname === routes.reports && method === "GET") {
      await handleReports(ctx, res);
      return;
    }
    if (pathname === routes.turns && method === "POST") {
      await handleTurnPost(ctx, req, res);
      return;
    }
    if (pathname === routes.turns && method === "GET") {
      await handleTurnHistory(ctx, res, url);
      return;
    }
    if (pathname === routes.events && method === "GET") {
      handleEvents(ctx, req, res);
      return;
    }
    if (pathname.startsWith(`${routes.positions}/`) && method === "GET") {
      let positionId: string;
      try {
        positionId = decodeURIComponent(pathname.slice(routes.positions.length + 1));
      } catch {
        throw new OrgApiError(errorCodes.not_found, 404, "malformed position id");
      }
      await handlePositionGet(ctx, res, positionId);
      return;
    }

    const knownPaths = Object.values(routes) as string[];
    if (knownPaths.includes(pathname) || pathname.startsWith(`${routes.positions}/`)) {
      sendJson(
        res,
        405,
        new OrgApiError(errorCodes.method_not_allowed, 405, `method ${method} not allowed`).toBody(),
      );
      return;
    }
    sendJson(
      res,
      404,
      new OrgApiError(errorCodes.not_found, 404, `no route: ${method} ${pathname}`).toBody(),
    );
  } catch (err) {
    try {
      sendError(res, err);
    } catch {
      // Response already closed (e.g. SSE drop); nothing else to do.
    }
  }
}

type IncomingMessageLike = http.IncomingMessage;
