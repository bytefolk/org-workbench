import type { ServerResponse } from "node:http";
import { OrgApiError, errorCodes } from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { sendJson } from "../http.js";

export async function handlePositionGet(
  ctx: ControlPlaneContext,
  res: ServerResponse,
  positionId: string,
): Promise<void> {
  const ws = ctx.workspace.requireOpen();
  const role = ws.organization.roles.find((entry) => entry.id === positionId);
  if (!role) {
    throw new OrgApiError(errorCodes.position_missing, 404, `position not found: ${positionId}`);
  }
  sendJson(res, 200, {
    schemaVersion: "position-card.v1",
    position: {
      id: role.id,
      name: role.name,
      description: role.description,
      reportTo: role.reportTo,
      mode: role.mode,
      /** Context scope summary (single source = organization file). */
      contextScope: role.memoryScope,
      permissions: { toolAllow: role.toolAllow, toolDeny: role.toolDeny },
      budget: role.budget ?? null,
      metadata: role.metadata,
    },
  });
}
