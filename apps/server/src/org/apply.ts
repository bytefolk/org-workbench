import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CHANGE_MANIFEST_SCHEMA_VERSION,
  OrgApiError,
  errorCodes,
  isPositionId,
} from "@org-workbench/shared";
import type {
  AddPositionChange,
  ChangeManifest,
  OrgApplyFailure,
  OrgApplyResult,
  OrgApplySuccess,
  OrgChange,
  OrgRole,
} from "@org-workbench/shared";
import type { ControlPlaneContext } from "../context.js";

export const RUNTIME_DIR = ".digital-employee";
export const POSITIONS_DIR = "positions";
export const MAX_POSITION_DEPTH = 8;

export const stagingConflictCodes = {
  positionExists: "org_apply_position_exists",
  positionMissing: "org_apply_position_missing",
  cycle: "org_apply_cycle",
  ownerDelete: "org_apply_owner_delete",
  maxDepth: "org_apply_max_depth",
  destinationExists: "org_apply_destination_exists",
} as const;

interface ApplyOutcome {
  status: number;
  body: OrgApplyResult;
}

export interface ProposalPosition {
  id: string;
  directory: string;
  reportTo: string | null;
  depth: number;
}

/**
 * POST /org/apply orchestrator for the directory-driven engine contract.
 *
 * The client first validates the complete manifest against an in-memory view,
 * then materializes the proposal directly in positions/. The engine is the
 * sole organization validator and owns every applied-state write. A rejected
 * apply intentionally leaves the proposal tree available for correction.
 */
const mutationTails = new Map<string, Promise<void>>();

export async function withOrgMutationLock<T>(workspaceDir: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(workspaceDir);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.then(() => tail);
  mutationTails.set(key, chained);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (mutationTails.get(key) === chained) mutationTails.delete(key);
  }
}

export async function applyChangeManifest(
  ctx: ControlPlaneContext,
  rawBody: unknown,
): Promise<ApplyOutcome> {
  const ws = ctx.workspace.requireOpen();
  return withOrgMutationLock(ws.dir, () => applyChangeManifestUnlocked(ctx, rawBody));
}

async function applyChangeManifestUnlocked(
  ctx: ControlPlaneContext,
  rawBody: unknown,
): Promise<ApplyOutcome> {
  const ws = ctx.workspace.requireOpen();
  const manifest = validateManifest(rawBody);
  const proposal = await scanProposalTree(ws.dir);
  validateProposalChanges(proposal, manifest, ws.organization.owner);
  await materializeProposal(ws.dir, manifest);

  const engineResult = await ctx.driver.apply(ws.dir);
  if (engineResult.status === "engine_unavailable") {
    return failure(errorCodes.engine_unavailable, engineResult.message, true, 503);
  }
  if (engineResult.status === "engine_capability_missing") {
    return failure(errorCodes.engine_capability_missing, engineResult.message, false, 503);
  }
  if (engineResult.status === "failed") {
    return failure(engineResult.code, engineResult.message, engineResult.retryable, 422);
  }

  const version = await ctx.workspace.reloadAppliedOrganization();
  ctx.bus.publish("org.updated", {
    workspace: ws.dir,
    version,
    changes:
      engineResult.result?.changes ?? manifest.changes.map(changeDigest),
  });
  const body: OrgApplySuccess = {
    status: "applied",
    version,
    changesApplied: manifest.changes.length,
  };
  return { status: 200, body };
}

function failure(
  code: string,
  message: string,
  retryable: boolean,
  status: number,
): ApplyOutcome {
  const body: OrgApplyFailure = { status: "failed", code, message, retryable };
  return { status, body };
}

export async function scanProposalTree(workspaceDir: string): Promise<ProposalPosition[]> {
  const root = path.join(workspaceDir, POSITIONS_DIR);
  const positions: ProposalPosition[] = [];
  const seen = new Set<string>();

  const scanPosition = async (
    directory: string,
    id: string,
    reportTo: string | null,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_POSITION_DEPTH) {
      throw conflict(stagingConflictCodes.maxDepth, `position tree exceeds maxDepth=${MAX_POSITION_DEPTH}`);
    }
    if (!isPositionId(id)) {
      throw conflict("workspace_org_tree_invalid_position_id", `invalid position id: ${id}`);
    }
    if (seen.has(id)) {
      throw conflict("workspace_org_tree_duplicate_position", `duplicate position id: ${id}`);
    }
    seen.add(id);
    positions.push({ id, directory, reportTo, depth });

    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      if (!(await isRegularFile(path.join(child, "employee.json")))) continue;
      await scanPosition(child, entry.name, id, depth + 1);
    }
  };

  let entries;
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  } catch {
    throw conflict("workspace_org_positions_missing", "positions/ directory missing");
  }
  for (const entry of entries) {
    const directory = path.join(root, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !(await isRegularFile(path.join(directory, "employee.json")))) {
      throw conflict(
        "workspace_org_tree_position_invalid",
        `invalid top-level position entry: ${entry.name} (positions/${entry.name} must be a regular directory containing employee.json; remove the stray directory or restore its employee package, then retry)`,
      );
    }
    await scanPosition(directory, entry.name, null, 1);
  }
  return positions;
}

async function isRegularFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function validateProposalChanges(
  proposal: ProposalPosition[],
  manifest: ChangeManifest,
  owner: string,
): void {
  const parents = new Map(proposal.map((position) => [position.id, position.reportTo]));
  for (const change of manifest.changes) {
    if (change.op === "add") {
      const id = change.position.id;
      if (parents.has(id)) {
        throw conflict(stagingConflictCodes.positionExists, `add: position already exists: ${id}`);
      }
      requireParent(parents, change.position.reportTo, "add");
      parents.set(id, change.position.reportTo);
    } else if (change.op === "move") {
      if (!parents.has(change.id)) {
        throw conflict(stagingConflictCodes.positionMissing, `move: position not found: ${change.id}`);
      }
      requireParent(parents, change.reportTo, "move");
      if (change.reportTo === change.id || isDescendant(parents, change.reportTo, change.id)) {
        throw conflict(stagingConflictCodes.cycle, `move would create a reporting cycle: ${change.id}`);
      }
      parents.set(change.id, change.reportTo);
    } else {
      if (!parents.has(change.id)) {
        throw conflict(stagingConflictCodes.positionMissing, `delete: position not found: ${change.id}`);
      }
      if (change.id === owner) {
        throw conflict(stagingConflictCodes.ownerDelete, "delete: the owner position cannot be disbanded");
      }
      const removed = new Set([change.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [id, parent] of parents) {
          if (parent !== null && removed.has(parent) && !removed.has(id)) {
            removed.add(id);
            changed = true;
          }
        }
      }
      for (const id of removed) parents.delete(id);
    }
  }
  for (const id of parents.keys()) {
    if (proposalDepth(parents, id) > MAX_POSITION_DEPTH) {
      throw conflict(stagingConflictCodes.maxDepth, `position tree exceeds maxDepth=${MAX_POSITION_DEPTH}`);
    }
  }
}

function requireParent(
  parents: Map<string, string | null>,
  parent: string | null,
  operation: string,
): void {
  if (parent !== null && !parents.has(parent)) {
    throw conflict(stagingConflictCodes.positionMissing, `${operation}: reportTo target not found: ${parent}`);
  }
}

function isDescendant(
  parents: Map<string, string | null>,
  candidate: string | null,
  ancestor: string,
): boolean {
  let cursor = candidate;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestor) return true;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

function proposalDepth(parents: Map<string, string | null>, id: string): number {
  let depth = 1;
  let cursor = parents.get(id) ?? null;
  const seen = new Set([id]);
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw conflict(stagingConflictCodes.cycle, `reporting cycle includes ${id}`);
    }
    seen.add(cursor);
    depth += 1;
    cursor = parents.get(cursor) ?? null;
  }
  return depth;
}

function conflict(code: string, message: string): OrgApiError {
  return new OrgApiError(code, 422, message);
}

async function materializeProposal(
  workspaceDir: string,
  manifest: ChangeManifest,
): Promise<void> {
  const positionsRoot = path.join(workspaceDir, POSITIONS_DIR);
  const runtimeDir = path.join(workspaceDir, RUNTIME_DIR);
  const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;

  for (const change of manifest.changes) {
    const current = new Map(
      (await scanProposalTree(workspaceDir)).map((position) => [position.id, position]),
    );
    if (change.op === "add") {
      const parent = change.position.reportTo === null ? null : current.get(change.position.reportTo);
      const destination = path.join(parent?.directory ?? positionsRoot, change.position.id);
      await assertDestinationAvailable(destination);
      await writePositionSkeleton(destination, change);
      continue;
    }
    const source = current.get(change.id);
    if (!source) throw conflict(stagingConflictCodes.positionMissing, `${change.op}: position not found: ${change.id}`);
    if (change.op === "move") {
      const parent = change.reportTo === null ? null : current.get(change.reportTo);
      const destination = path.join(parent?.directory ?? positionsRoot, change.id);
      if (source.directory === destination) continue;
      await assertDestinationAvailable(destination);
      await fs.rename(source.directory, destination);
      continue;
    }
    const backupRoot = path.join(runtimeDir, "backup");
    await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await fs.rename(source.directory, path.join(backupRoot, `${change.id}-${stamp}`));
  }
}

async function assertDestinationAvailable(destination: string): Promise<void> {
  try {
    await fs.lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw conflict(stagingConflictCodes.destinationExists, `proposal destination already exists: ${path.basename(destination)}`);
}

function changeDigest(change: OrgChange): { op: string; id: string } {
  return change.op === "add"
    ? { op: change.op, id: change.position.id }
    : { op: change.op, id: change.id };
}

function validateManifest(rawBody: unknown): ChangeManifest {
  const invalid = (message: string): OrgApiError =>
    new OrgApiError(errorCodes.manifest_invalid, 400, message);
  if (typeof rawBody !== "object" || rawBody === null) throw invalid("manifest must be a JSON object");
  const body = rawBody as Record<string, unknown>;
  if (body.schemaVersion !== CHANGE_MANIFEST_SCHEMA_VERSION) {
    throw invalid(`manifest schemaVersion must be ${CHANGE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    throw invalid("manifest changes must be a non-empty array");
  }
  for (const [index, rawChange] of body.changes.entries()) {
    if (typeof rawChange !== "object" || rawChange === null) throw invalid(`changes[${index}] must be an object`);
    const change = rawChange as Record<string, unknown>;
    if (change.op === "add") validateAdd(index, change);
    else if (change.op === "move") validateMove(index, change);
    else if (change.op === "delete") validateDelete(index, change);
    else throw invalid(`changes[${index}].op must be add | move | delete`);
  }
  return rawBody as ChangeManifest;
}

function validateAdd(index: number, change: Record<string, unknown>): void {
  const invalid = (message: string): OrgApiError =>
    new OrgApiError(errorCodes.manifest_invalid, 400, `changes[${index}]: ${message}`);
  const position = change.position;
  if (typeof position !== "object" || position === null) throw invalid("position must be an object");
  const p = position as Record<string, unknown>;
  if (!isPositionId(p.id)) throw invalid("position.id is invalid");
  if (typeof p.name !== "string" || p.name.length === 0) throw invalid("position.name required");
  if (typeof p.description !== "string" || p.description.length === 0) throw invalid("position.description required");
  if (p.reportTo !== null && !isPositionId(p.reportTo)) throw invalid("position.reportTo must be a position id | null");
  if (p.mode !== "read_only" && p.mode !== "approval_required") throw invalid("position.mode is invalid");
  if (typeof p.memoryScope !== "string") throw invalid("position.memoryScope must be a string");
  for (const key of ["toolAllow", "toolDeny"] as const) {
    const value = p[key];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw invalid(`position.${key} must be string[]`);
  }
  if (typeof p.budget !== "object" || p.budget === null) throw invalid("position.budget required");
  const budget = p.budget as Record<string, unknown>;
  for (const scope of ["perTask", "perDay"] as const) {
    const value = budget[scope];
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`position.budget.${scope} must be an object`);
  }
}

function validateMove(index: number, change: Record<string, unknown>): void {
  if (!isPositionId(change.id)) {
    throw new OrgApiError(errorCodes.manifest_invalid, 400, `changes[${index}]: id is invalid`);
  }
  if (change.reportTo !== null && !isPositionId(change.reportTo)) {
    throw new OrgApiError(errorCodes.manifest_invalid, 400, `changes[${index}]: reportTo must be a position id | null`);
  }
}

function validateDelete(index: number, change: Record<string, unknown>): void {
  if (!isPositionId(change.id)) {
    throw new OrgApiError(errorCodes.manifest_invalid, 400, `changes[${index}]: id is invalid`);
  }
}

async function writePositionSkeleton(dir: string, change: AddPositionChange): Promise<void> {
  const role = change.position;
  const employee: Record<string, unknown> = {
    $schema: "https://raw.githubusercontent.com/fullstack-ai-infra/digital-employee/main/configs/employee-package.schema.json",
    schemaVersion: "employee-package.v1alpha1",
    name: role.id,
    version: "0.1.0",
    description: role.description,
    license: "Apache-2.0",
    authors: ["org-workbench"],
    host: { protocol: "agent-host.v1", requiredCapabilities: [] },
    entrypoints: {
      skill: "./SKILL.md",
      inputSchema: "./schemas/input.schema.json",
      outputSchema: "./schemas/output.schema.json",
    },
    policy: {
      mode: role.mode,
      network: "deny",
      filesystem: { read: ["./knowledge/**"], write: [] },
      mcpTools: [],
    },
    assets: ["./knowledge/README.md"],
  };
  const inputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: { message: { type: "string", minLength: 1, maxLength: 20000 }, context: { type: "object" } },
  };
  const outputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["status", "answer", "citations"],
    properties: {
      status: { enum: ["answered", "escalated"] },
      answer: { type: ["string", "null"] },
      citations: { type: "array", items: { type: "object" } },
    },
  };
  const skill = `---\nname: ${role.id}\ndescription: ${JSON.stringify(role.description)}\n---\n\n# ${role.name}\n\n${role.description}\n`;
  const files = new Map<string, string>([
    ["employee.json", `${JSON.stringify(employee, null, 2)}\n`],
    ["SKILL.md", skill],
    ["schemas/input.schema.json", `${JSON.stringify(inputSchema, null, 2)}\n`],
    ["schemas/output.schema.json", `${JSON.stringify(outputSchema, null, 2)}\n`],
    ["knowledge/README.md", "# Approved knowledge\n\nReplace this generated placeholder with reviewed knowledge.\n"],
  ]);
  for (const [relative, content] of files) {
    const target = path.join(dir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  await writePrivateAtomic(path.join(dir, "budget.json"), `${JSON.stringify(role.budget, null, 2)}\n`);
}

async function writePrivateAtomic(file: string, content: string): Promise<void> {
  const temporary = `${file}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    await fs.writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
