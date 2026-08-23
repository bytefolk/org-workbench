import fs from "node:fs/promises";
import path from "node:path";
import {
  ORG_TREE_SCHEMA_VERSION,
  OrgApiError,
  WORKSPACE_MANIFEST_SCHEMA_VERSION,
  WORKSPACE_ORG_SCHEMA_VERSION,
  errorCodes,
} from "@org-workbench/shared";
import type {
  OrganizationFile,
  OrgTreeSnapshot,
  OrgTreeVersion,
  WorkspaceManifest,
} from "@org-workbench/shared";

export const ORGANIZATION_FILE = "organization.v1alpha1.json";
export const MANIFEST_FILE = "workspace.json";
export const POSITIONS_DIR = "positions";

export interface OpenWorkspace {
  dir: string;
  manifest: WorkspaceManifest;
  organization: OrganizationFile;
  version: OrgTreeVersion;
}

/**
 * Current workspace holder + org-tree snapshot builder. Structural checks only:
 * budget lawfulness and apply validation belong to digital-employee, never here.
 */
export class WorkspaceState {
  private current: OpenWorkspace | null = null;
  private seq = 0;

  /** Currently open workspace, or null. */
  get active(): OpenWorkspace | null {
    return this.current;
  }

  async openWorkspace(rawDir: string): Promise<OpenWorkspace> {
    const dir = path.resolve(rawDir);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      throw new OrgApiError(errorCodes.workspace_invalid, 422, `workspace directory not found: ${dir}`);
    }
    if (!stat.isDirectory()) {
      throw new OrgApiError(errorCodes.workspace_invalid, 422, `not a directory: ${dir}`);
    }
    const manifest = await this.readJson<WorkspaceManifest>(
      path.join(dir, MANIFEST_FILE),
      "workspace manifest missing (workspace.json)",
    );
    if (manifest.schemaVersion !== WORKSPACE_MANIFEST_SCHEMA_VERSION) {
      throw new OrgApiError(
        errorCodes.workspace_invalid,
        422,
        `unsupported workspace manifest schemaVersion: ${String(manifest.schemaVersion)}`,
      );
    }
    const organization = await this.readJson<OrganizationFile>(
      path.join(dir, ORGANIZATION_FILE),
      "organization file missing (organization.v1alpha1.json)",
    );
    if (organization.schemaVersion !== WORKSPACE_ORG_SCHEMA_VERSION) {
      throw new OrgApiError(
        errorCodes.workspace_invalid,
        422,
        `unsupported organization schemaVersion: ${String(organization.schemaVersion)}`,
      );
    }
    if (
      typeof organization.business !== "string" ||
      typeof organization.owner !== "string" ||
      !Array.isArray(organization.roles)
    ) {
      throw new OrgApiError(
        errorCodes.workspace_invalid,
        422,
        "organization file failed structural checks (business/owner/roles)",
      );
    }
    let positionsStat;
    try {
      positionsStat = await fs.stat(path.join(dir, POSITIONS_DIR));
    } catch {
      throw new OrgApiError(errorCodes.workspace_invalid, 422, "positions/ directory missing");
    }
    if (!positionsStat.isDirectory()) {
      throw new OrgApiError(errorCodes.workspace_invalid, 422, "positions/ is not a directory");
    }
    this.seq += 1;
    this.current = {
      dir,
      manifest,
      organization,
      version: { seq: this.seq, updatedAt: organization.updatedAt },
    };
    return this.current;
  }

  requireOpen(): OpenWorkspace {
    if (!this.current) {
      throw new OrgApiError(
        errorCodes.workspace_not_open,
        422,
        "no workspace is open; POST /workspace/open first",
      );
    }
    return this.current;
  }

  /** Replace the organization file after an atomic publish; bumps the version stamp. */
  replaceOrganization(organization: OrganizationFile, updatedAt: string): OrgTreeVersion {
    const ws = this.requireOpen();
    ws.organization = organization;
    this.seq += 1;
    ws.version = { seq: this.seq, updatedAt };
    return ws.version;
  }

  /** Bump version stamp without changing organization content (e.g. workspace open). */
  touch(): OrgTreeVersion | null {
    if (!this.current) return null;
    this.seq += 1;
    this.current.version = { seq: this.seq, updatedAt: this.current.organization.updatedAt };
    return this.current.version;
  }

  snapshot(): OrgTreeSnapshot {
    const ws = this.requireOpen();
    return {
      schemaVersion: ORG_TREE_SCHEMA_VERSION,
      workspacePath: ws.dir,
      business: ws.organization.business,
      owner: ws.organization.owner,
      edges: ws.organization.roles.map((role) => ({
        positionId: role.id,
        reportTo: role.reportTo,
      })),
      positions: ws.organization.roles,
      organization: ws.organization,
      version: ws.version,
    };
  }

  private async readJson<T>(file: string, missingMessage: string): Promise<T> {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new OrgApiError(errorCodes.workspace_invalid, 422, missingMessage);
      }
      throw new OrgApiError(
        errorCodes.workspace_invalid,
        422,
        `unreadable workspace file: ${path.basename(file)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OrgApiError(
        errorCodes.workspace_invalid,
        422,
        `workspace file is not valid JSON: ${path.basename(file)}`,
      );
    }
  }
}
