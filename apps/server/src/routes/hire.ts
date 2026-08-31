/**
 * POST /hire — the only employee-creation channel (#33, consuming
 * digital-employee #194/#198 hire-request.v1alpha1 at b3d54bf).
 *
 * Chain: strict request-shape gate → deterministic skeleton bytes →
 * packageRef.digest BEFORE staging → hire-request.v1alpha1 envelope sealed
 * with a canonical digest → `hire validate` (static, fail-closed upstream) →
 * stage skeleton → `org apply` engine adjudication (same seam as move/delete)
 * → reload + layout append + org.updated. Every gate fails closed; a failed
 * engine adjudication rolls the staged directory back, so no half-hired
 * position survives. The former change-manifest `add` bypass is gone.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  HIRE_REQUEST_SCHEMA_VERSION,
  OrgApiError,
  errorCodes,
  isPositionId,
} from "@org-workbench/shared";
import type {
  HireFailure,
  HireMcpGrant,
  HireRequestEnvelope,
  HireSuccess,
  McpRequestedMode,
  McpServerTransport,
  NetworkPolicy,
  PositionBudget,
} from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";
import { readJsonBody, sendJson } from "../http.js";
import { computeEnvelopeDigest } from "../turns/envelope.js";
import {
  POSITIONS_DIR,
  assertDestinationAvailable,
  buildPositionSkeletonFiles,
  scanProposalTree,
  withOrgMutationLock,
  writeSkeletonFiles,
} from "../org/apply.js";
import { parentKey } from "../org/layout.js";

const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2048;
/** Upstream MAX_BUDGET_CAP (packages/engine/src/budget.ts), mirrored. */
const MAX_BUDGET_CAP = 1_000_000_000;
/** Upstream packageRef.version pattern (configs/hire-request.schema.json). */
const PACKAGE_VERSION = "v1alpha1";

/**
 * #89 MCP grant bounds, mirrored verbatim from the two upstream validators the
 * staged package must survive: employee-package.schema.json `policy.mcpTools`
 * (`validateMcpTools`) and employee-mcp.v1alpha1
 * (packages/core/src/employee-mcp.ts). The control plane rejects here so an
 * operator sees a 400 at the request gate instead of an opaque upstream
 * `employee_mcp_*` code after staging.
 */
const MCP_IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/;
const MCP_ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MCP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const MCP_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_MCP_SERVERS = 64;
/** Upstream bounds mcpTools only by uniqueness; the control plane also caps count. */
const MAX_MCP_TOOLS = 64;
const MAX_MCP_COMMAND_LENGTH = 1_024;
const MAX_MCP_ARGS = 128;
const MAX_MCP_ARG_LENGTH = 4_096;
const MAX_MCP_ENVIRONMENT = 128;
const MAX_MCP_HEADERS = 64;
const MAX_MCP_URL_LENGTH = 2_000;

function invalid(message: string): OrgApiError {
  return new OrgApiError(errorCodes.hire_request_invalid, 400, message);
}

function boundedNonEmptyString(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= limit
  );
}

function positiveBoundedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_BUDGET_CAP;
}

function assertBudgetScope(scope: unknown, label: string): Record<string, number> {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    throw invalid(`budget.${label} must be an object`);
  }
  const record = scope as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "tokens" && key !== "iterations") {
      throw invalid(`budget.${label}.${key} is not part of the frozen budgetScope vocabulary`);
    }
  }
  // REQ-006 parity: a token cap on both cycles is the submission floor.
  if (!positiveBoundedInteger(record.tokens)) {
    throw invalid(`budget.${label}.tokens must be a positive integer no larger than ${MAX_BUDGET_CAP}`);
  }
  if (record.iterations !== undefined && !positiveBoundedInteger(record.iterations)) {
    throw invalid(`budget.${label}.iterations must be a positive integer no larger than ${MAX_BUDGET_CAP}`);
  }
  const result: Record<string, number> = { tokens: record.tokens };
  if (record.iterations !== undefined) result.iterations = record.iterations;
  return result;
}

/** Mirrors employee-mcp.ts `requireString`: non-empty, bounded, no control characters. */
function mcpString(value: unknown, label: string, limit: number, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    MCP_CONTROL_CHARACTERS.test(value) ||
    (pattern && !pattern.test(value.trim()))
  ) {
    throw invalid(`${label} is invalid`);
  }
  return value.trim();
}

/** Mirrors employee-mcp.ts `stringList`: bounded, element-validated, duplicate-free. */
function mcpStringList(value: unknown, label: string, maxItems: number, limit: number, pattern?: RegExp): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw invalid(`${label} is invalid`);
  const result = value.map((item, index) => mcpString(item, `${label}[${index}]`, limit, pattern));
  if (new Set(result).size !== result.length) throw invalid(`${label} contains a duplicate value`);
  return result;
}

function assertKnownMcpKeys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw invalid(`unknown field: ${label}.${key}`);
  }
  return record;
}

/** HTTPS only, and never a URL that smuggles credentials or a fragment (employee-mcp.ts parity). */
function assertMcpHttpsUrl(value: unknown, label: string): string {
  const normalized = mcpString(value, label, MAX_MCP_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw invalid(`${label} must be an absolute https URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw invalid(`${label} must be an https URL without credentials or a fragment`);
  }
  return parsed.toString();
}

function assertMcpTransport(value: unknown, label: string): McpServerTransport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  const type = (value as Record<string, unknown>).type;
  if (type === "stdio") {
    const transport = assertKnownMcpKeys(value, ["type", "command", "args", "environment"], label);
    return {
      type: "stdio",
      command: mcpString(transport.command, `${label}.command`, MAX_MCP_COMMAND_LENGTH),
      args: mcpStringList(transport.args, `${label}.args`, MAX_MCP_ARGS, MAX_MCP_ARG_LENGTH),
      // Environment variable NAMES only: the operator never types a secret
      // value into the hire request, and none is written to the package.
      environment: mcpStringList(
        transport.environment,
        `${label}.environment`,
        MAX_MCP_ENVIRONMENT,
        MAX_MCP_ENVIRONMENT,
        MCP_ENVIRONMENT_NAME_PATTERN,
      ),
    };
  }
  if (type === "http") {
    const transport = assertKnownMcpKeys(value, ["type", "url", "headers"], label);
    const rawHeaders = transport.headers ?? [];
    if (!Array.isArray(rawHeaders) || rawHeaders.length > MAX_MCP_HEADERS) {
      throw invalid(`${label}.headers is invalid`);
    }
    return {
      type: "http",
      url: assertMcpHttpsUrl(transport.url, `${label}.url`),
      headers: rawHeaders.map((header, index) => {
        const headerLabel = `${label}.headers[${index}]`;
        const item = assertKnownMcpKeys(header, ["name", "valueFromEnv"], headerLabel);
        return {
          name: mcpString(item.name, `${headerLabel}.name`, 128, MCP_HEADER_NAME_PATTERN),
          valueFromEnv: mcpString(item.valueFromEnv, `${headerLabel}.valueFromEnv`, 128, MCP_ENVIRONMENT_NAME_PATTERN),
        };
      }),
    };
  }
  throw invalid(`${label}.type must be stdio or http`);
}

/**
 * #89: tools and servers are accepted together or not at all — upstream
 * rejects a non-empty `policy.mcpTools` without an `entrypoints.mcp` file
 * (`mcp_tools_require_mcp_entrypoint`), and a server list with no granted tool
 * would stage a connection the employee can never use.
 */
function assertMcpGrant(value: unknown, mode: "read_only" | "approval_required"): HireMcpGrant {
  const grant = assertKnownMcpKeys(value, ["tools", "servers"], "mcp");
  if (!Array.isArray(grant.tools) || grant.tools.length === 0 || grant.tools.length > MAX_MCP_TOOLS) {
    throw invalid(`mcp.tools must be a non-empty array of at most ${MAX_MCP_TOOLS} tools`);
  }
  if (!Array.isArray(grant.servers) || grant.servers.length === 0 || grant.servers.length > MAX_MCP_SERVERS) {
    throw invalid(`mcp.servers must be a non-empty array of at most ${MAX_MCP_SERVERS} servers`);
  }
  const toolNames = new Set<string>();
  const tools = grant.tools.map((tool, index) => {
    const label = `mcp.tools[${index}]`;
    const entry = assertKnownMcpKeys(tool, ["name", "requestedMode"], label);
    const name = mcpString(entry.name, `${label}.name`, 128, MCP_IDENTIFIER_PATTERN);
    if (toolNames.has(name)) throw invalid(`${label}.name is a duplicate`);
    toolNames.add(name);
    if (entry.requestedMode !== "read" && entry.requestedMode !== "write") {
      throw invalid(`${label}.requestedMode must be read or write`);
    }
    const requestedMode: McpRequestedMode = entry.requestedMode;
    // Upstream `read_only_employee_cannot_request_write_mcp_tools`: reject
    // rather than silently downgrade, so the operator's granted capability is
    // never quietly different from what they asked for.
    if (mode === "read_only" && requestedMode === "write") {
      throw invalid(`${label}.requestedMode must be read for a read_only employee`);
    }
    return { name, requestedMode };
  });
  const serverNames = new Set<string>();
  const servers = grant.servers.map((server, index) => {
    const label = `mcp.servers[${index}]`;
    const entry = assertKnownMcpKeys(server, ["name", "transport"], label);
    const name = mcpString(entry.name, `${label}.name`, 128, MCP_IDENTIFIER_PATTERN);
    if (serverNames.has(name)) throw invalid(`${label}.name is a duplicate`);
    serverNames.add(name);
    return { name, transport: assertMcpTransport(entry.transport, `${label}.transport`) };
  });
  return { tools, servers };
}

interface ValidatedHireRequest {
  positionId: string;
  name: string;
  description: string;
  reportTo: string | null;
  mode: "read_only" | "approval_required";
  budget: PositionBudget;
  deadline?: string;
  /** #87: defaults to "deny" when the request omits it (today's behavior). */
  network: NetworkPolicy;
  /** #89: absent means no MCP grant and no `entrypoints.mcp` (today's behavior). */
  mcp?: HireMcpGrant;
}

function assertHireRequest(raw: unknown): ValidatedHireRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalid("hire request must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const known = new Set(["positionId", "name", "description", "reportTo", "mode", "budget", "deadline", "network", "mcp"]);
  for (const key of Object.keys(body)) {
    if (!known.has(key)) throw invalid(`unknown field: ${key}`);
  }
  if (!isPositionId(body.positionId)) throw invalid("positionId is invalid");
  if (!boundedNonEmptyString(body.name, MAX_NAME_BYTES)) throw invalid("name must be a non-empty string no larger than 128 bytes");
  if (!boundedNonEmptyString(body.description, MAX_DESCRIPTION_BYTES)) throw invalid("description must be a non-empty string no larger than 2048 bytes");
  if (body.reportTo !== null && !isPositionId(body.reportTo)) throw invalid("reportTo must be a position id or null");
  if (body.mode !== "read_only" && body.mode !== "approval_required") throw invalid("mode must be read_only or approval_required");
  if (body.network !== undefined && body.network !== "deny" && body.network !== "host_policy") {
    throw invalid("network must be deny or host_policy");
  }
  if (typeof body.budget !== "object" || body.budget === null || Array.isArray(body.budget)) {
    throw invalid("budget is required");
  }
  const budget = body.budget as Record<string, unknown>;
  for (const key of Object.keys(budget)) {
    if (key !== "perTask" && key !== "perDay") throw invalid(`budget.${key} is not part of the frozen budget vocabulary`);
  }
  const perTask = assertBudgetScope(budget.perTask, "perTask");
  const perDay = assertBudgetScope(budget.perDay, "perDay");
  if (body.deadline !== undefined && (typeof body.deadline !== "string" || Number.isNaN(Date.parse(body.deadline)))) {
    throw invalid("deadline must parse as an ISO 8601 timestamp");
  }
  return {
    positionId: body.positionId,
    name: body.name.trim(),
    description: body.description.trim(),
    reportTo: body.reportTo,
    mode: body.mode,
    budget: { perTask, perDay } as PositionBudget,
    ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
    network: body.network === "host_policy" ? "host_policy" : "deny",
    ...(body.mcp !== undefined ? { mcp: assertMcpGrant(body.mcp, body.mode) } : {}),
  };
}

function buildHireEnvelope(input: {
  workspaceRef: string;
  positionId: string;
  packageDigest: string;
  targetParentId: string;
  budget: PositionBudget;
  deadline?: string;
}): HireRequestEnvelope {
  const body: Record<string, unknown> = {
    schemaVersion: HIRE_REQUEST_SCHEMA_VERSION,
    workspaceRef: input.workspaceRef,
    packageRef: {
      name: input.positionId,
      version: PACKAGE_VERSION,
      digest: input.packageDigest,
    },
    targetParentId: input.targetParentId,
    budget: input.budget,
    requestedBy: "operator",
  };
  if (input.deadline !== undefined) body.deadline = input.deadline;
  return { ...(body as Omit<HireRequestEnvelope, "envelopeDigest">), envelopeDigest: computeEnvelopeDigest(body) };
}

export async function handleHirePost(
  ctx: ControlPlaneContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const request = assertHireRequest(await readJsonBody<unknown>(req));
  const outcome = await withOrgMutationLock(ctx.workspace.requireOpen().dir, () => hireUnlocked(ctx, request));
  sendJson(res, outcome.status, outcome.body);
}

/**
 * S2 phase vocabulary (DS-33-001 §2): `hire.progress` marks the control-plane
 * gate boundaries only — no fabricated progress; the renderer keeps the last
 * phase copy when no event arrives.
 */
type HirePhase = "validate" | "stage" | "apply";

function emitHireProgress(ctx: ControlPlaneContext, positionId: string, phase: HirePhase): void {
  ctx.bus.publish("hire.progress", { positionId, phase });
}

async function hireUnlocked(
  ctx: ControlPlaneContext,
  request: ReturnType<typeof assertHireRequest>,
): Promise<{ status: number; body: HireSuccess | HireFailure }> {
  const ws = ctx.workspace.requireOpen();
  const exists = ws.organization.roles.some((role) => role.id === request.positionId);
  if (exists) {
    return {
      status: 409,
      body: { status: "failed", code: "hire_position_exists", message: `position already exists: ${request.positionId}`, retryable: false },
    };
  }
  if (request.reportTo !== null && !ws.organization.roles.some((role) => role.id === request.reportTo)) {
    throw invalid(`reportTo position not found: ${request.reportTo}`);
  }
  // Root hires report to the company owner; targetParentId is never empty upstream.
  const targetParentId = request.reportTo ?? ws.organization.owner;

  const files = buildPositionSkeletonFiles({
    id: request.positionId,
    name: request.name,
    description: request.description,
    mode: request.mode,
    budget: request.budget,
    network: request.network,
    ...(request.mcp !== undefined ? { mcp: request.mcp } : {}),
  });
  const employeeBytes = files.get("employee.json");
  if (employeeBytes === undefined) throw new Error("skeleton builder must emit employee.json");
  const packageDigest = `sha256:${crypto.createHash("sha256").update(employeeBytes, "utf8").digest("hex")}`;
  const envelope = buildHireEnvelope({
    workspaceRef: ws.dir,
    positionId: request.positionId,
    packageDigest,
    targetParentId,
    budget: request.budget,
    ...(request.deadline !== undefined ? { deadline: request.deadline } : {}),
  });

  // Fail-closed gate one: static upstream validation before ANY filesystem effect.
  emitHireProgress(ctx, request.positionId, "validate");
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "owb-hire-"));
  const envelopeFile = path.join(staging, "hire-request.json");
  let validate;
  try {
    await fs.writeFile(envelopeFile, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    validate = await ctx.hireDriver.hireValidate(envelopeFile);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  if (validate.status === "engine_unavailable") {
    return { status: 503, body: { status: "failed", code: errorCodes.engine_unavailable, message: validate.message, retryable: true } };
  }
  if (validate.status === "engine_capability_missing") {
    return { status: 503, body: { status: "failed", code: errorCodes.engine_capability_missing, message: validate.message, retryable: false } };
  }
  if (validate.status === "failed") {
    return { status: 422, body: { status: "failed", code: validate.code, message: validate.message, retryable: false } };
  }

  // Gate two: stage the exact digested bytes, then let the engine adjudicate
  // the rebuilt tree through the same org apply seam move/delete use.
  emitHireProgress(ctx, request.positionId, "stage");
  const proposal = await scanProposalTree(ws.dir);
  const parent = proposal.find((position) => position.id === targetParentId);
  const destination = path.join(parent?.directory ?? path.join(ws.dir, POSITIONS_DIR), request.positionId);
  await assertDestinationAvailable(destination);
  await writeSkeletonFiles(destination, files);

  emitHireProgress(ctx, request.positionId, "apply");
  const engineResult = await ctx.driver.apply(ws.dir);
  if (engineResult.status !== "applied") {
    await fs.rm(destination, { recursive: true, force: true });
    if (engineResult.status === "engine_unavailable") {
      return { status: 503, body: { status: "failed", code: errorCodes.engine_unavailable, message: engineResult.message, retryable: true } };
    }
    if (engineResult.status === "engine_capability_missing") {
      return { status: 503, body: { status: "failed", code: errorCodes.engine_capability_missing, message: engineResult.message, retryable: false } };
    }
    return { status: 422, body: { status: "failed", code: engineResult.code, message: engineResult.message, retryable: engineResult.retryable } };
  }

  const version = await ctx.workspace.reloadAppliedOrganization();
  // D-32 linkage: a hired employee appends at the end of its parent's order.
  const order = { ...ctx.workspace.getLayout().order };
  const key = parentKey(request.reportTo);
  const siblings = order[key] ?? [];
  if (!siblings.includes(request.positionId)) {
    order[key] = [...siblings, request.positionId];
    await ctx.workspace.setLayoutOrder(order);
  }
  ctx.bus.publish("org.updated", {
    workspace: ws.dir,
    version,
    changes: [{ op: "hire", id: request.positionId }],
  });
  return {
    status: 200,
    body: { status: "hired", positionId: request.positionId, version },
  };
}
