/**
 * Read-only document file routing contract (#35 S2, DS-35-001 rev-1 §5).
 *
 * Strictly additive: listing and reading position document files
 * (SKILL.md / knowledge / schemas). No write surface, no doc-ref
 * contract — creation and reference contracts belong to S4.
 */

export const DOCS_FILE_LIST_SCHEMA_VERSION = "docs-file-list.v1" as const;
export const DOCS_FILE_SCHEMA_VERSION = "docs-file.v1" as const;

/** One listed entry under a position's package directory. */
export interface DocsFileEntry {
  /** POSIX-style path relative to the position directory (e.g. `SKILL.md`, `knowledge/README.md`). */
  path: string;
  kind: "file";
  size: number;
  /** File-level version provenance: last-modified time, ISO 8601. */
  modifiedAt: string;
}

export interface DocsFileListResponse {
  schemaVersion: typeof DOCS_FILE_LIST_SCHEMA_VERSION;
  positionId: string;
  /** Deterministic: sorted by `path`, symlinks excluded (fail-closed guard). */
  files: DocsFileEntry[];
}

export interface DocsFileResponse {
  schemaVersion: typeof DOCS_FILE_SCHEMA_VERSION;
  positionId: string;
  path: string;
  /** UTF-8 text content; the route only serves allowlisted text extensions. */
  content: string;
  /** File-level version (mtime ISO 8601) — not edit history. */
  version: string;
  size: number;
  modifiedAt: string;
}
