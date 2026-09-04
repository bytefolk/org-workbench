import type { ServerResponse } from "node:http";
import { OrgApiError, errorCodes } from "@org-workbench/shared";
import type {
  DriveObject,
  DriveObjectDetailResponse,
  DriveObjectListResponse,
} from "@org-workbench/shared";
import { sendJson } from "../http.js";

/**
 * Drive plane proxy (MVP) — forwards `list`/`detail` reads to the bytefolk/mem
 * `memd` HTTP API when `MEM_URL` is set, and serves a deterministic mock
 * fixture otherwise so the end-to-end desktop UI is exercisable without a
 * running mem service. Uploads are handled by the desktop shell today (main
 * process pickers) and are stubbed at this seam — see /drive/upload below.
 *
 * The workbench never re-implements the memory plane. The upstream response
 * shape is normalized once here (mem's `/v1/files` file record → the frozen
 * `drive-object.v1`) so the renderer never depends on mem field naming.
 */

const MOCK_OBJECTS: DriveObject[] = [
  {
    id: "mock-mem-001",
    name: "会议纪要-Q3-规划.md",
    size: 4821,
    mime: "text/markdown",
    createdAt: "2026-08-30T09:14:22.000Z",
    summary: "Q3 规划复盘：产品/研发/GTM 三条线的 OKR 与关键风险。",
  },
  {
    id: "mock-mem-002",
    name: "客户访谈录音-2026-08-27.m4a",
    size: 2_318_411,
    mime: "audio/mp4",
    createdAt: "2026-08-27T15:02:08.000Z",
    summary: "3 位企业客户对新版控制面的定价异议摘要。",
  },
  {
    id: "mock-mem-003",
    name: "架构评审-灯箱.png",
    size: 812_004,
    mime: "image/png",
    createdAt: "2026-08-21T02:41:11.000Z",
  },
];

interface MemFileRecord {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  size?: unknown;
  mime?: unknown;
  mime_type?: unknown;
  created_at?: unknown;
  summary?: unknown;
  caption?: unknown;
}

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMemFile(raw: MemFileRecord): DriveObject | null {
  const id = coerceString(raw.id);
  if (id === "") return null;
  const name = coerceString(raw.name, coerceString(raw.path, id));
  const size = coerceNumber(raw.size, 0);
  const mime = coerceString(raw.mime, coerceString(raw.mime_type, "application/octet-stream"));
  const createdAt = coerceString(raw.created_at, new Date(0).toISOString());
  const summary = coerceString(raw.summary, coerceString(raw.caption, ""));
  return {
    id,
    name,
    size,
    mime,
    createdAt,
    ...(summary !== "" ? { summary } : {}),
  };
}

function memUrlFromEnv(): string | null {
  const raw = process.env.MEM_URL ?? process.env.ORG_WORKBENCH_MEM_URL ?? "";
  if (raw.trim() === "") return null;
  return raw.replace(/\/$/, "");
}

function memToken(): string | null {
  const raw = process.env.MEM_TOKEN ?? process.env.ORG_WORKBENCH_MEM_TOKEN ?? "";
  return raw.trim() === "" ? null : raw;
}

async function fetchMem(pathname: string): Promise<{ ok: true; body: unknown } | OrgApiError> {
  const base = memUrlFromEnv();
  if (base === null) {
    return new OrgApiError(
      errorCodes.drive_not_configured,
      503,
      "MEM_URL is not set; drive plane serves a mocked fixture only",
    );
  }
  const url = `${base}${pathname}`;
  const token = memToken();
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      return new OrgApiError(
        errorCodes.drive_upstream_failed,
        response.status,
        `mem upstream failed: ${response.status}`,
      );
    }
    const body = (await response.json()) as unknown;
    return { ok: true, body };
  } catch (err) {
    return new OrgApiError(
      errorCodes.drive_upstream_unavailable,
      502,
      `mem upstream unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function matches(object: DriveObject, needle: string): boolean {
  const hay = `${object.name} ${object.summary ?? ""}`.toLowerCase();
  return hay.includes(needle.toLowerCase());
}

/** GET /drive/list?q=<search>: mem `/v1/files?query=<search>` when configured. */
export async function handleDriveList(res: ServerResponse, url: URL): Promise<void> {
  const q = url.searchParams.get("q") ?? "";
  if (q.length > 256) {
    throw new OrgApiError(errorCodes.drive_request_invalid, 400, "q parameter exceeds 256 chars");
  }
  const configured = memUrlFromEnv() !== null;
  if (!configured) {
    const filtered = q === "" ? MOCK_OBJECTS : MOCK_OBJECTS.filter((entry) => matches(entry, q));
    const body: DriveObjectListResponse = {
      schemaVersion: "drive-object-list.v1",
      objects: filtered,
      mocked: true,
    };
    sendJson(res, 200, body);
    return;
  }
  const query = q === "" ? "" : `?query=${encodeURIComponent(q)}`;
  const result = await fetchMem(`/v1/files${query}`);
  if (result instanceof OrgApiError) throw result;
  const raw = result.body as { files?: unknown; items?: unknown };
  const list = Array.isArray(raw.files)
    ? (raw.files as MemFileRecord[])
    : Array.isArray(raw.items)
      ? (raw.items as MemFileRecord[])
      : [];
  const objects = list
    .map((entry) => normalizeMemFile(entry))
    .filter((entry): entry is DriveObject => entry !== null);
  const body: DriveObjectListResponse = {
    schemaVersion: "drive-object-list.v1",
    objects,
    mocked: false,
  };
  sendJson(res, 200, body);
}

/** GET /drive/detail?id=<memFileId>. */
export async function handleDriveDetail(res: ServerResponse, url: URL): Promise<void> {
  const id = url.searchParams.get("id") ?? "";
  if (id === "" || id.length > 128) {
    throw new OrgApiError(errorCodes.drive_request_invalid, 400, "id parameter is required");
  }
  const configured = memUrlFromEnv() !== null;
  if (!configured) {
    const found = MOCK_OBJECTS.find((entry) => entry.id === id) ?? null;
    if (found === null) {
      throw new OrgApiError(errorCodes.asset_not_found, 404, `drive object not found: ${id}`);
    }
    const body: DriveObjectDetailResponse = {
      schemaVersion: "drive-object.v1",
      object: found,
      mocked: true,
    };
    sendJson(res, 200, body);
    return;
  }
  const result = await fetchMem(`/v1/files/${encodeURIComponent(id)}`);
  if (result instanceof OrgApiError) throw result;
  const object = normalizeMemFile(result.body as MemFileRecord);
  if (object === null) {
    throw new OrgApiError(errorCodes.asset_not_found, 404, `drive object not found: ${id}`);
  }
  const body: DriveObjectDetailResponse = {
    schemaVersion: "drive-object.v1",
    object,
    mocked: false,
  };
  sendJson(res, 200, body);
}

/** POST /drive/upload: stubbed until the mem multipart contract is pinned. */
export async function handleDriveUpload(res: ServerResponse): Promise<void> {
  // TODO(mem-upload): forward multipart PUT to `/v1/files` once the mem
  // upload path lands with a stable content-type. The renderer already goes
  // through a whitelisted IPC seam so wiring is additive.
  sendJson(res, 202, {
    stub: true,
    message:
      "drive upload seam is stubbed; renderer IPC is wired but multipart PUT to /v1/files is pending contract sign-off",
  });
}
