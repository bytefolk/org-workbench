import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OrgApiError,
  TURN_HISTORY_SCHEMA_VERSION,
  TURN_RECORD_SCHEMA_VERSION,
  errorCodes,
  isPositionId,
} from "@org-workbench/shared";
import type { TurnEngine, TurnHistory, TurnRecord } from "@org-workbench/shared";

const STATE_ROOT = path.join(".digital-employee", "workbench", "conversations");
const MAX_TURNS_PER_POSITION = 256;
const MAX_TURN_ID_LENGTH = 256;
// A one-megachar engine result is represented in model.delta, the terminal,
// and the record's output field. Keep that upstream boundary persistable
// while retaining a finite aggregate history bound.
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_TURN_RECORD_BYTES = 20 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;

interface ConversationMetadata {
  schemaVersion: "conversation.v1";
  conversationId: string;
  positionId: string;
  createdAt: string;
}

function storageError(message: string): OrgApiError {
  return new OrgApiError(errorCodes.turn_storage_failed, 500, message);
}

export function assertPositionId(value: unknown): string {
  if (!isPositionId(value)) {
    throw new OrgApiError(
      errorCodes.turn_position_invalid,
      400,
      "positionId must match [a-z0-9]+(?:-[a-z0-9]+)* and be at most 64 characters",
    );
  }
  return value;
}

function isBoundedTurnId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_TURN_ID_LENGTH
  );
}

function turnRecordFile(workspace: string, positionId: string, turnId: unknown): string {
  if (
    !isBoundedTurnId(turnId) ||
    turnId.includes("/") ||
    turnId.includes("\\") ||
    turnId.includes("\0")
  ) {
    throw storageError("local turn record contains an unsafe turnId");
  }
  const turnsDir = path.resolve(conversationDir(workspace, positionId), "turns");
  const file = path.resolve(turnsDir, `${turnId}.json`);
  if (path.dirname(file) !== turnsDir) {
    throw storageError("local turn record path escapes its conversation");
  }
  return file;
}

async function atomicWriteJson(file: string, value: unknown, maxBytes: number): Promise<void> {
  const dir = path.dirname(file);
  const payload = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(payload, "utf8") > maxBytes) {
    throw storageError("local state record exceeds its bounded size");
  }
  const temporary = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function conversationDir(workspace: string, positionId: string): string {
  return path.join(workspace, STATE_ROOT, positionId);
}

async function readJson(file: string, maxBytes: number): Promise<unknown> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw storageError("local state record is not a bounded regular file");
  }
  return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
}

async function preparePositionDirectories(workspace: string, positionId: string): Promise<void> {
  const rootStat = await fs.lstat(workspace);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw storageError("workspace must be a real directory for local turn state");
  }
  const segments = [".digital-employee", "workbench", "conversations", positionId, "turns"];
  let current = workspace;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw storageError("local turn state path must not contain symbolic links");
      }
    } catch (error) {
      if (error instanceof OrgApiError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      const created = await fs.lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw storageError("local turn state directory creation raced with an unsafe path");
      }
    }
    if (index >= 1) await fs.chmod(current, 0o700);
  }
}

function isConversationMetadata(value: unknown): value is ConversationMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === "conversation.v1" &&
    typeof record.conversationId === "string" &&
    record.conversationId.length > 0 &&
    isPositionId(record.positionId) &&
    typeof record.createdAt === "string"
  );
}

function isTurnRecord(value: unknown): value is TurnRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<TurnRecord>;
  return (
    record.schemaVersion === TURN_RECORD_SCHEMA_VERSION &&
    typeof record.conversationId === "string" &&
    isBoundedTurnId(record.turnId) &&
    isPositionId(record.positionId) &&
    (record.engine === "qoder" || record.engine === "claude-code") &&
    ["running", "completed", "failed", "indeterminate"].includes(String(record.status)) &&
    typeof record.input === "string" &&
    typeof record.envelopeDigest === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.events)
  );
}

export class TurnStore {
  private metadataLocks = new Map<string, Promise<ConversationMetadata>>();
  private activeTurns = new Set<string>();

  async begin(input: {
    workspace: string;
    positionId: string;
    turnId: string;
    engine: TurnEngine;
    message: string;
    envelopeDigest: string;
    now: string;
  }): Promise<TurnRecord> {
    assertPositionId(input.positionId);
    turnRecordFile(input.workspace, input.positionId, input.turnId);
    await preparePositionDirectories(input.workspace, input.positionId);
    await this.assertCapacity(input.workspace, input.positionId);
    const metadata = await this.ensureConversation(input.workspace, input.positionId, input.now);
    const record: TurnRecord = {
      schemaVersion: TURN_RECORD_SCHEMA_VERSION,
      conversationId: metadata.conversationId,
      turnId: input.turnId,
      positionId: input.positionId,
      engine: input.engine,
      status: "running",
      input: input.message,
      envelopeDigest: input.envelopeDigest,
      createdAt: input.now,
      updatedAt: input.now,
      events: [],
    };
    const activeKey = this.activeTurnKey(input.workspace, input.positionId, input.turnId);
    this.activeTurns.add(activeKey);
    try {
      await this.writeTurn(input.workspace, record);
    } catch (error) {
      this.activeTurns.delete(activeKey);
      throw error;
    }
    return record;
  }

  async finish(workspace: string, record: TurnRecord): Promise<void> {
    assertPositionId(record.positionId);
    turnRecordFile(workspace, record.positionId, record.turnId);
    await preparePositionDirectories(workspace, record.positionId);
    await this.writeTurn(workspace, record);
    this.activeTurns.delete(this.activeTurnKey(workspace, record.positionId, record.turnId));
  }

  async history(workspace: string, positionId: string, now: string): Promise<TurnHistory> {
    assertPositionId(positionId);
    await preparePositionDirectories(workspace, positionId);
    const metadata = await this.ensureConversation(workspace, positionId, now);
    const turnsDir = path.join(conversationDir(workspace, positionId), "turns");
    let names: string[];
    try {
      names = (await fs.readdir(turnsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      throw storageError("local turn history is unreadable");
    }
    if (names.length > MAX_TURNS_PER_POSITION) {
      throw storageError("local turn history exceeds the bounded record count");
    }
    let historyBytes = 0;
    const turns: TurnRecord[] = [];
    for (const name of names) {
      let raw: unknown;
      try {
        const file = path.join(turnsDir, name);
        const stat = await fs.lstat(file);
        historyBytes += stat.size;
        if (historyBytes > MAX_HISTORY_BYTES) {
          throw storageError("local turn history exceeds the bounded total size");
        }
        raw = await readJson(file, MAX_TURN_RECORD_BYTES);
      } catch {
        throw storageError("local turn history contains an unreadable record");
      }
      if (
        !isTurnRecord(raw) ||
        raw.positionId !== positionId ||
        raw.conversationId !== metadata.conversationId ||
        turnRecordFile(workspace, raw.positionId, raw.turnId) !== path.resolve(turnsDir, name)
      ) {
        throw storageError("local turn history contains an invalid record");
      }
      if (
        raw.status === "running" &&
        !this.activeTurns.has(this.activeTurnKey(workspace, raw.positionId, raw.turnId))
      ) {
        const recovered: TurnRecord = {
          ...raw,
          status: "indeterminate",
          updatedAt: now,
          error: {
            code: "turn_interrupted",
            message: "the control plane stopped before the turn reached a trusted terminal",
            retryable: false,
          },
        };
        await this.writeTurn(workspace, recovered);
        turns.push(recovered);
      } else {
        turns.push(raw);
      }
    }
    turns.sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.turnId.localeCompare(right.turnId, "en")
        : left.createdAt.localeCompare(right.createdAt, "en"),
    );
    return {
      schemaVersion: TURN_HISTORY_SCHEMA_VERSION,
      conversationId: metadata.conversationId,
      positionId,
      turns,
    };
  }

  private async ensureConversation(
    workspace: string,
    positionId: string,
    now: string,
  ): Promise<ConversationMetadata> {
    const key = `${workspace}\0${positionId}`;
    const existing = this.metadataLocks.get(key);
    if (existing) return existing;
    const pending = this.loadOrCreateConversation(workspace, positionId, now);
    this.metadataLocks.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.metadataLocks.delete(key);
      throw error;
    }
  }

  private activeTurnKey(workspace: string, positionId: string, turnId: string): string {
    return `${path.resolve(workspace)}\0${positionId}\0${turnId}`;
  }

  private async loadOrCreateConversation(
    workspace: string,
    positionId: string,
    now: string,
  ): Promise<ConversationMetadata> {
    const dir = conversationDir(workspace, positionId);
    const file = path.join(dir, "conversation.json");
    try {
      const raw = await readJson(file, MAX_METADATA_BYTES);
      if (!isConversationMetadata(raw) || raw.positionId !== positionId) {
        throw storageError("local conversation metadata is invalid");
      }
      await fs.chmod(file, 0o600);
      return raw;
    } catch (error) {
      if (error instanceof OrgApiError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw storageError("local conversation metadata is unreadable");
      }
    }
    const metadata: ConversationMetadata = {
      schemaVersion: "conversation.v1",
      conversationId: crypto.randomUUID(),
      positionId,
      createdAt: now,
    };
    try {
      await atomicWriteJson(file, metadata, MAX_METADATA_BYTES);
      return metadata;
    } catch {
      throw storageError("local conversation metadata could not be persisted");
    }
  }

  private async writeTurn(workspace: string, record: TurnRecord): Promise<void> {
    const file = turnRecordFile(workspace, record.positionId, record.turnId);
    try {
      await atomicWriteJson(file, record, MAX_TURN_RECORD_BYTES);
    } catch {
      throw storageError("local turn record could not be persisted atomically");
    }
  }

  private async assertCapacity(workspace: string, positionId: string): Promise<void> {
    const turnsDir = path.join(conversationDir(workspace, positionId), "turns");
    let names: string[];
    try {
      names = (await fs.readdir(turnsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      throw storageError("local turn history is unreadable");
    }
    if (names.length >= MAX_TURNS_PER_POSITION) {
      throw storageError("local turn history reached the bounded record count");
    }
    let bytes = 0;
    for (const name of names) {
      const stat = await fs.lstat(path.join(turnsDir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw storageError("local turn history contains a non-regular record");
      }
      bytes += stat.size;
      if (bytes >= MAX_HISTORY_BYTES) {
        throw storageError("local turn history reached the bounded total size");
      }
    }
  }
}
