import fs from "node:fs/promises";
import path from "node:path";
import {
  DOCS_FILE_LIST_SCHEMA_VERSION,
  DOCS_FILE_SCHEMA_VERSION,
  OrgApiError,
  errorCodes,
  isPositionId,
} from "@org-workbench/shared";
import type { DocsFileEntry, DocsFileListResponse, DocsFileResponse } from "@org-workbench/shared";
import type { ServerResponse } from "node:http";
import type { ControlPlaneContext } from "../context.js";
import { sendJson } from "../http.js";
import { POSITIONS_DIR } from "../workspace-state.js";

/**
 * Read-only document file routing (#35 S2, DS-35-001 rev-1 §5).
 *
 * Guards are fail-closed and modeled on the repository storage discipline:
 * reads resolve strictly inside `positions/<id>/`, symlinks are refused,
 * only allowlisted text extensions are served, and oversized files are
 * rejected rather than streamed.
 */

/** Text extensions a position document may carry; everything else is refused. */
const READABLE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml"]);

/** Hard cap for a served document; larger files are refused, not streamed. */
export const MAX_DOC_FILE_BYTES = 256 * 1024;

function requirePositionDir(ctx: ControlPlaneContext, positionId: string): string {
  if (positionId === "" || !isPositionId(positionId)) {
    throw new OrgApiError(errorCodes.docs_request_invalid, 400, `invalid position id: ${positionId}`);
  }
  const ws = ctx.workspace.requireOpen();
  const role = ws.organization.roles.find((entry) => entry.id === positionId);
  if (!role) {
    throw new OrgApiError(errorCodes.position_missing, 404, `position not found: ${positionId}`);
  }
  return path.resolve(ws.dir, POSITIONS_DIR, positionId);
}

/** Resolve a relative doc path strictly inside the position dir; refuse escapes. */
function resolveDocPath(positionDir: string, rawPath: string): string {
  if (rawPath === "") {
    throw new OrgApiError(errorCodes.docs_request_invalid, 400, "path parameter is required");
  }
  const resolved = path.resolve(positionDir, rawPath);
  const relative = path.relative(positionDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OrgApiError(errorCodes.docs_forbidden, 403, `path escapes the position directory: ${rawPath}`);
  }
  if (relative.split(path.sep).some((segment) => segment.startsWith("."))) {
    throw new OrgApiError(errorCodes.docs_forbidden, 403, `hidden path segments are not routable: ${rawPath}`);
  }
  return resolved;
}

/** Recursively list regular files; symlinks and hidden entries are excluded. */
async function walkFiles(dir: string, base: string, entries: DocsFileEntry[]): Promise<void> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const absolute = path.join(dir, dirent.name);
    if (dirent.isSymbolicLink()) continue;
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      await walkFiles(absolute, base, entries);
      continue;
    }
    if (!stat.isFile()) continue;
    entries.push({
      path: path.relative(base, absolute).split(path.sep).join("/"),
      kind: "file",
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
    });
  }
}

export async function handleDocsList(ctx: ControlPlaneContext, res: ServerResponse, url: URL): Promise<void> {
  const positionId = url.searchParams.get("position") ?? "";
  const positionDir = requirePositionDir(ctx, positionId);
  const files: DocsFileEntry[] = [];
  try {
    await walkFiles(positionDir, positionDir, files);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new OrgApiError(errorCodes.docs_missing, 404, `position directory missing: ${positionId}`);
    }
    throw error;
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const body: DocsFileListResponse = {
    schemaVersion: DOCS_FILE_LIST_SCHEMA_VERSION,
    positionId,
    files,
  };
  sendJson(res, 200, body);
}

export async function handleDocsRead(ctx: ControlPlaneContext, res: ServerResponse, url: URL): Promise<void> {
  const positionId = url.searchParams.get("position") ?? "";
  const rawPath = url.searchParams.get("path") ?? "";
  const positionDir = requirePositionDir(ctx, positionId);
  const resolved = resolveDocPath(positionDir, rawPath);

  let stat;
  try {
    const lstat = await fs.lstat(resolved);
    if (lstat.isSymbolicLink()) {
      throw new OrgApiError(errorCodes.docs_forbidden, 403, `symlinks are not routable: ${rawPath}`);
    }
    stat = lstat;
  } catch (error) {
    if (error instanceof OrgApiError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new OrgApiError(errorCodes.docs_missing, 404, `document not found: ${rawPath}`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new OrgApiError(errorCodes.docs_missing, 404, `not a document file: ${rawPath}`);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (!READABLE_EXTENSIONS.has(extension)) {
    throw new OrgApiError(errorCodes.docs_forbidden, 403, `extension not routable: ${extension}`);
  }
  if (stat.size > MAX_DOC_FILE_BYTES) {
    throw new OrgApiError(errorCodes.docs_forbidden, 403, `document exceeds ${MAX_DOC_FILE_BYTES} bytes: ${rawPath}`);
  }
  const content = await fs.readFile(resolved, "utf8");
  const modifiedAt = new Date(stat.mtimeMs).toISOString();
  const body: DocsFileResponse = {
    schemaVersion: DOCS_FILE_SCHEMA_VERSION,
    positionId,
    path: path.relative(positionDir, resolved).split(path.sep).join("/"),
    content,
    version: modifiedAt,
    size: stat.size,
    modifiedAt,
  };
  sendJson(res, 200, body);
}
