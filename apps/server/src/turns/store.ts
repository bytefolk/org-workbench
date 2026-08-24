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
import type { EngineEvent, TurnTerminalReason } from "@org-workbench/shared";
import { assertSessionId } from "../sessions/store.js";

const STATE_ROOT = path.join(".digital-employee", "workbench", "conversations");
const MAX_TURNS_PER_POSITION = 256;
const MAX_TURN_ID_LENGTH = 256;
// A one-megachar engine result is represented in model.delta, the terminal,
// and the record's output field. Keep that upstream boundary persistable
// while retaining a finite aggregate history bound.
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_TURN_RECORD_BYTES = 20 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_EVENTS = 4_096;
const MAX_MODEL_CHARACTERS = 1_048_576;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const MAX_TERMINAL_OUTPUT_BYTES = MAX_MODEL_CHARACTERS * 6 + 2;
const ENGINE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ENVELOPE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TERMINAL_REASONS = new Set<TurnTerminalReason>([
  "goal_met",
  "invalid_output_exhausted",
  "turn_budget_exceeded",
  "position_budget_exceeded",
  "iteration_cap",
  "doom_loop",
  "deadline_exceeded",
  "cancelled",
  "engine_internal_error",
]);

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

export interface AtomicTurnTemporaryHandle {
  writeFile(payload: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicTurnDirectoryHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicTurnWriteOperations {
  openTemporary(file: string): Promise<AtomicTurnTemporaryHandle>;
  rename(source: string, target: string): Promise<void>;
  chmod(file: string, mode: number): Promise<void>;
  openDirectory(directory: string): Promise<AtomicTurnDirectoryHandle>;
  removeTemporary(file: string): Promise<void>;
}

export const nodeAtomicTurnWriteOperations: AtomicTurnWriteOperations = {
  async openTemporary(file) {
    const handle = await fs.open(file, "wx", 0o600);
    return {
      writeFile: (payload) => handle.writeFile(payload, "utf8"),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename: (source, target) => fs.rename(source, target),
  chmod: (file, mode) => fs.chmod(file, mode),
  async openDirectory(directory) {
    const handle = await fs.open(directory, "r");
    return {
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  removeTemporary: (file) => fs.rm(file, { force: true }),
};

async function atomicWriteJson(
  file: string,
  value: unknown,
  maxBytes: number,
  operations: AtomicTurnWriteOperations,
): Promise<void> {
  const dir = path.dirname(file);
  const payload = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(payload, "utf8") > maxBytes) {
    throw storageError("local state record exceeds its bounded size");
  }
  const temporary = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let fileHandle: AtomicTurnTemporaryHandle | undefined;
  let directoryHandle: AtomicTurnDirectoryHandle | undefined;
  try {
    fileHandle = await operations.openTemporary(temporary);
    await fileHandle.writeFile(payload);
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await operations.rename(temporary, file);
    await operations.chmod(file, 0o600);
    directoryHandle = await operations.openDirectory(dir);
    await directoryHandle.sync();
    await directoryHandle.close();
    directoryHandle = undefined;
  } catch (error) {
    try {
      await fileHandle?.close();
    } catch {
      // Preserve the first durability failure while still attempting cleanup.
    }
    try {
      await directoryHandle?.close();
    } catch {
      // Preserve the first durability failure while still attempting cleanup.
    }
    try {
      await operations.removeTemporary(temporary);
    } catch {
      // The original write failure is authoritative and never includes payload data.
    }
    throw error;
  }
}

function conversationDir(workspace: string, positionId: string): string {
  return path.join(workspace, STATE_ROOT, positionId);
}

function sessionConversationDir(workspace: string, sessionId: string): string {
  return path.join(
    workspace,
    ".digital-employee",
    "workbench",
    "sessions",
    "conversations",
    assertSessionId(sessionId),
  );
}

function sessionTurnRecordFile(workspace: string, sessionId: string, turnId: unknown): string {
  if (
    !isBoundedTurnId(turnId) ||
    turnId.includes("/") ||
    turnId.includes("\\") ||
    turnId.includes("\0")
  ) {
    throw storageError("local session turn record contains an unsafe turnId");
  }
  const turnsDir = path.resolve(sessionConversationDir(workspace, sessionId), "turns");
  const file = path.resolve(turnsDir, `${turnId}.json`);
  if (path.dirname(file) !== turnsDir) {
    throw storageError("local session turn record path escapes its conversation");
  }
  return file;
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

async function prepareSessionDirectories(workspace: string, sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  const rootStat = await fs.lstat(workspace);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw storageError("workspace must be a real directory for local session turn state");
  }
  const segments = [
    ".digital-employee",
    "workbench",
    "sessions",
    "conversations",
    sessionId,
    "turns",
  ];
  let current = workspace;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw storageError("local session turn state path must not contain symbolic links");
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
        throw storageError("local session turn directory creation raced with an unsafe path");
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

export function isTurnRecord(value: unknown): value is TurnRecord {
  if (!isObjectRecord(value)) return false;
  if (!hasExactKeys(
    value,
    [
      "schemaVersion", "conversationId", "turnId", "positionId", "engine", "status",
      "input", "envelopeDigest", "createdAt", "updatedAt", "events",
    ],
    ["runId", "output", "error"],
  )) return false;
  if (
    value.schemaVersion !== TURN_RECORD_SCHEMA_VERSION ||
    !isBoundedIdentifier(value.conversationId) ||
    !isBoundedTurnId(value.turnId) ||
    value.turnId.includes("/") || value.turnId.includes("\\") || value.turnId.includes("\0") ||
    !isPositionId(value.positionId) ||
    (value.engine !== "qoder" && value.engine !== "claude-code") ||
    !["running", "completed", "failed", "indeterminate"].includes(String(value.status)) ||
    typeof value.input !== "string" || Buffer.byteLength(value.input, "utf8") > MAX_INPUT_BYTES ||
    typeof value.envelopeDigest !== "string" ||
    !ENVELOPE_DIGEST_PATTERN.test(value.envelopeDigest) ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    !Array.isArray(value.events) || value.events.length > MAX_EVENTS
  ) return false;
  const events: EngineEvent[] = [];
  for (const event of value.events) {
    const validated = validateEngineEvent(event);
    if (validated === null) return false;
    events.push(validated);
  }
  if (!isValidEventSequence(events)) return false;
  const hasRunId = Object.hasOwn(value, "runId");
  const hasOutput = Object.hasOwn(value, "output");
  const hasError = Object.hasOwn(value, "error");
  if (hasRunId && !isBoundedIdentifier(value.runId)) return false;
  if (events.length > 0 && value.runId !== events[0]!.runId) return false;
  if (events.length === 0 && hasRunId) return false;
  const recordError = hasError ? validateRecordError(value.error) : null;
  if (hasError && recordError === null) return false;
  const terminal = events.at(-1);
  switch (value.status) {
    case "running":
      return events.length === 0 && !hasRunId && !hasOutput && !hasError;
    case "completed":
      return terminal?.type === "run.completed" && hasRunId && hasOutput && !hasError &&
        isBoundedJson(value.output, MAX_TERMINAL_OUTPUT_BYTES) &&
        JSON.stringify(value.output) === JSON.stringify(terminal.output);
    case "failed":
      return terminal?.type === "run.failed" && hasRunId && !hasOutput && recordError !== null &&
        recordError.code === terminal.error.code &&
        recordError.message === terminal.error.message &&
        recordError.retryable === terminal.error.retryable;
    case "indeterminate":
      return !hasOutput && recordError !== null;
    default:
      return false;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function isBoundedCodePoints(value: string, limit: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > limit) return false;
  }
  return true;
}

function isBoundedJson(value: unknown, limit: number): boolean {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && Buffer.byteLength(encoded, "utf8") <= limit;
  } catch {
    return false;
  }
}

function validateRecordError(
  value: unknown,
): { code: string; message: string; retryable: boolean } | null {
  if (!isObjectRecord(value) || !hasExactKeys(value, ["code", "message", "retryable"])) {
    return null;
  }
  if (
    typeof value.code !== "string" || !ENGINE_CODE_PATTERN.test(value.code) ||
    typeof value.message !== "string" ||
    Buffer.byteLength(value.message, "utf8") > MAX_DIAGNOSTIC_BYTES ||
    typeof value.retryable !== "boolean"
  ) return null;
  return { code: value.code, message: value.message, retryable: value.retryable };
}

function validateEngineEvent(value: unknown): EngineEvent | null {
  if (!isObjectRecord(value) || !isBoundedIdentifier(value.runId) || !isTimestamp(value.timestamp)) {
    return null;
  }
  const base = { runId: value.runId, timestamp: value.timestamp };
  switch (value.type) {
    case "run.started":
      return hasExactKeys(value, ["type", "runId", "timestamp"])
        ? { ...base, type: "run.started" }
        : null;
    case "model.delta":
      return hasExactKeys(value, ["type", "runId", "timestamp", "text"]) &&
        typeof value.text === "string" && isBoundedCodePoints(value.text, MAX_MODEL_CHARACTERS)
        ? { ...base, type: "model.delta", text: value.text }
        : null;
    case "usage": {
      if (!hasExactKeys(
        value,
        ["type", "runId", "timestamp"],
        ["inputTokens", "outputTokens", "totalTokens"],
      )) return null;
      for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
        if (value[key] !== undefined &&
          (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) return null;
      }
      return {
        ...base,
        type: "usage",
        ...(value.inputTokens !== undefined ? { inputTokens: value.inputTokens as number } : {}),
        ...(value.outputTokens !== undefined ? { outputTokens: value.outputTokens as number } : {}),
        ...(value.totalTokens !== undefined ? { totalTokens: value.totalTokens as number } : {}),
      };
    }
    case "run.completed":
      return hasExactKeys(value, ["type", "runId", "timestamp", "output", "terminalReason"]) &&
        value.terminalReason === "goal_met" &&
        isBoundedJson(value.output, MAX_TERMINAL_OUTPUT_BYTES)
        ? { ...base, type: "run.completed", output: value.output, terminalReason: "goal_met" }
        : null;
    case "run.failed": {
      if (!hasExactKeys(value, ["type", "runId", "timestamp", "error"]) ||
        !isObjectRecord(value.error) ||
        !hasExactKeys(value.error, ["code", "message", "retryable", "terminalReason"]) ||
        typeof value.error.code !== "string" || !ENGINE_CODE_PATTERN.test(value.error.code) ||
        typeof value.error.message !== "string" ||
        Buffer.byteLength(value.error.message, "utf8") > MAX_DIAGNOSTIC_BYTES ||
        typeof value.error.retryable !== "boolean" ||
        !TERMINAL_REASONS.has(value.error.terminalReason as TurnTerminalReason)) return null;
      return {
        ...base,
        type: "run.failed",
        error: {
          code: value.error.code,
          message: value.error.message,
          retryable: value.error.retryable,
          terminalReason: value.error.terminalReason as TurnTerminalReason,
        },
      };
    }
    default:
      return null;
  }
}

function isValidEventSequence(events: EngineEvent[]): boolean {
  if (events.length === 0) return true;
  if (events[0]!.type !== "run.started") return false;
  const runId = events[0]!.runId;
  let terminal = false;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.runId !== runId || (index > 0 && event.type === "run.started") || terminal) return false;
    if (event.type === "run.completed" || event.type === "run.failed") {
      terminal = true;
      if (index !== events.length - 1) return false;
    }
  }
  return true;
}

export class TurnStore {
  private metadataLocks = new Map<string, Promise<ConversationMetadata>>();
  private activeTurns = new Set<string>();

  constructor(
    private readonly options: {
      atomicWriteOperations?: AtomicTurnWriteOperations;
    } = {},
  ) {}

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

  async beginSession(input: {
    workspace: string;
    sessionId: string;
    positionId: string;
    turnId: string;
    engine: TurnEngine;
    message: string;
    envelopeDigest: string;
    now: string;
  }): Promise<TurnRecord> {
    const sessionId = assertSessionId(input.sessionId);
    assertPositionId(input.positionId);
    sessionTurnRecordFile(input.workspace, sessionId, input.turnId);
    await prepareSessionDirectories(input.workspace, sessionId);
    await this.assertSessionCapacity(input.workspace, sessionId);
    const metadata = await this.ensureSessionConversation(
      input.workspace,
      sessionId,
      input.positionId,
      input.now,
    );
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
    const activeKey = this.sessionActiveTurnKey(input.workspace, sessionId, input.turnId);
    this.activeTurns.add(activeKey);
    try {
      await this.writeSessionTurn(input.workspace, sessionId, record);
    } catch (error) {
      this.activeTurns.delete(activeKey);
      throw error;
    }
    return record;
  }

  async finishSession(workspace: string, sessionId: string, record: TurnRecord): Promise<void> {
    assertPositionId(record.positionId);
    sessionTurnRecordFile(workspace, sessionId, record.turnId);
    await prepareSessionDirectories(workspace, sessionId);
    await this.writeSessionTurn(workspace, sessionId, record);
    this.activeTurns.delete(this.sessionActiveTurnKey(workspace, sessionId, record.turnId));
  }

  hasActiveSessionTurns(workspace: string, sessionId: string): boolean {
    const prefix = `${path.resolve(workspace)}\0session:${assertSessionId(sessionId)}\0`;
    return [...this.activeTurns].some((key) => key.startsWith(prefix));
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

  async sessionHistory(
    workspace: string,
    sessionId: string,
    positionId: string,
    now: string,
  ): Promise<TurnHistory> {
    assertSessionId(sessionId);
    assertPositionId(positionId);
    await prepareSessionDirectories(workspace, sessionId);
    const metadata = await this.ensureSessionConversation(workspace, sessionId, positionId, now);
    const turnsDir = path.join(sessionConversationDir(workspace, sessionId), "turns");
    let names: string[];
    try {
      names = (await fs.readdir(turnsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      throw storageError("local session turn history is unreadable");
    }
    if (names.length > MAX_TURNS_PER_POSITION) {
      throw storageError("local session turn history exceeds the bounded record count");
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
          throw storageError("local session turn history exceeds the bounded total size");
        }
        raw = await readJson(file, MAX_TURN_RECORD_BYTES);
      } catch {
        throw storageError("local session turn history contains an unreadable record");
      }
      if (
        !isTurnRecord(raw) ||
        raw.positionId !== positionId ||
        raw.conversationId !== metadata.conversationId ||
        sessionTurnRecordFile(workspace, sessionId, raw.turnId) !== path.resolve(turnsDir, name)
      ) {
        throw storageError("local session turn history contains an invalid record");
      }
      if (
        raw.status === "running" &&
        !this.activeTurns.has(this.sessionActiveTurnKey(workspace, sessionId, raw.turnId))
      ) {
        const recovered: TurnRecord = {
          ...raw,
          status: "indeterminate",
          updatedAt: now,
          error: {
            code: "turn_interrupted",
            message: "the control plane stopped before the session turn reached a trusted terminal",
            retryable: false,
          },
        };
        await this.writeSessionTurn(workspace, sessionId, recovered);
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

  /** Read existing turn facts for D4 without creating conversations or
   * recovering state. Any malformed/symlinked source rejects the whole view. */
  async reportRecords(workspace: string): Promise<TurnRecord[]> {
    const root = path.join(workspace, STATE_ROOT);
    let positionEntries;
    try {
      await assertRealDirectoryChain(workspace, STATE_ROOT.split(path.sep));
      positionEntries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw storageError("local reports turn root is unreadable");
    }
    if (positionEntries.length > 1024) {
      throw storageError("local reports position count exceeds its bound");
    }
    const records: TurnRecord[] = [];
    let totalBytes = 0;
    for (const entry of positionEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !isPositionId(entry.name)) {
        throw storageError("local reports turn root contains an unsafe position");
      }
      const positionId = entry.name;
      const dir = conversationDir(workspace, positionId);
      await assertRealDirectory(dir, "local reports position path is unsafe");
      const metadata = await readJson(path.join(dir, "conversation.json"), MAX_METADATA_BYTES);
      if (!isConversationMetadata(metadata) || metadata.positionId !== positionId) {
        throw storageError("local reports conversation metadata is invalid");
      }
      const turnsDir = path.join(dir, "turns");
      await assertRealDirectory(turnsDir, "local reports turn directory is unsafe");
      const turnEntries = await fs.readdir(turnsDir, { withFileTypes: true });
      const jsonEntries = turnEntries.filter((turnEntry) => turnEntry.name.endsWith(".json"));
      if (jsonEntries.length > MAX_TURNS_PER_POSITION) {
        throw storageError("local reports turn count exceeds its bound");
      }
      for (const turnEntry of turnEntries) {
        if (turnEntry.name.startsWith(".") && turnEntry.name.endsWith(".tmp")) continue;
        if (!turnEntry.isFile() || turnEntry.isSymbolicLink() || !turnEntry.name.endsWith(".json")) {
          throw storageError("local reports turn directory contains an unsafe record");
        }
        const file = path.join(turnsDir, turnEntry.name);
        const stat = await fs.lstat(file);
        totalBytes += stat.size;
        if (totalBytes > MAX_HISTORY_BYTES) {
          throw storageError("local reports turn data exceeds its bounded total size");
        }
        const raw = await readJson(file, MAX_TURN_RECORD_BYTES);
        if (
          !isTurnRecord(raw) ||
          raw.positionId !== positionId ||
          raw.conversationId !== metadata.conversationId ||
          turnRecordFile(workspace, raw.positionId, raw.turnId) !== path.resolve(file)
        ) {
          throw storageError("local reports contains an invalid turn record");
        }
        records.push(raw);
      }
    }
    records.sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.turnId.localeCompare(left.turnId, "en")
        : right.updatedAt.localeCompare(left.updatedAt, "en"),
    );
    return records;
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

  private sessionActiveTurnKey(workspace: string, sessionId: string, turnId: string): string {
    return `${path.resolve(workspace)}\0session:${sessionId}\0${turnId}`;
  }

  private async ensureSessionConversation(
    workspace: string,
    sessionId: string,
    positionId: string,
    now: string,
  ): Promise<ConversationMetadata> {
    const key = `${workspace}\0session:${sessionId}`;
    const existing = this.metadataLocks.get(key);
    if (existing) return existing;
    const pending = this.loadOrCreateSessionConversation(workspace, sessionId, positionId, now);
    this.metadataLocks.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.metadataLocks.delete(key);
      throw error;
    }
  }

  private async loadOrCreateSessionConversation(
    workspace: string,
    sessionId: string,
    positionId: string,
    now: string,
  ): Promise<ConversationMetadata> {
    const dir = sessionConversationDir(workspace, sessionId);
    const file = path.join(dir, "conversation.json");
    try {
      const raw = await readJson(file, MAX_METADATA_BYTES);
      if (
        !isConversationMetadata(raw) ||
        raw.positionId !== positionId ||
        raw.conversationId !== sessionId
      ) {
        throw storageError("local session conversation metadata is invalid");
      }
      await fs.chmod(file, 0o600);
      return raw;
    } catch (error) {
      if (error instanceof OrgApiError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw storageError("local session conversation metadata is unreadable");
      }
    }
    const metadata: ConversationMetadata = {
      schemaVersion: "conversation.v1",
      conversationId: sessionId,
      positionId,
      createdAt: now,
    };
    try {
      await atomicWriteJson(
        file,
        metadata,
        MAX_METADATA_BYTES,
        this.options.atomicWriteOperations ?? nodeAtomicTurnWriteOperations,
      );
      return metadata;
    } catch {
      throw storageError("local session conversation metadata could not be persisted");
    }
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
      await atomicWriteJson(
        file,
        metadata,
        MAX_METADATA_BYTES,
        this.options.atomicWriteOperations ?? nodeAtomicTurnWriteOperations,
      );
      return metadata;
    } catch {
      throw storageError("local conversation metadata could not be persisted");
    }
  }

  private async writeTurn(workspace: string, record: TurnRecord): Promise<void> {
    const file = turnRecordFile(workspace, record.positionId, record.turnId);
    try {
      await atomicWriteJson(
        file,
        record,
        MAX_TURN_RECORD_BYTES,
        this.options.atomicWriteOperations ?? nodeAtomicTurnWriteOperations,
      );
    } catch {
      throw storageError("local turn record could not be persisted atomically");
    }
  }

  private async writeSessionTurn(
    workspace: string,
    sessionId: string,
    record: TurnRecord,
  ): Promise<void> {
    const file = sessionTurnRecordFile(workspace, sessionId, record.turnId);
    try {
      await atomicWriteJson(
        file,
        record,
        MAX_TURN_RECORD_BYTES,
        this.options.atomicWriteOperations ?? nodeAtomicTurnWriteOperations,
      );
    } catch {
      throw storageError("local session turn record could not be persisted atomically");
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

  private async assertSessionCapacity(workspace: string, sessionId: string): Promise<void> {
    const turnsDir = path.join(sessionConversationDir(workspace, sessionId), "turns");
    let names: string[];
    try {
      names = (await fs.readdir(turnsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      throw storageError("local session turn history is unreadable");
    }
    if (names.length >= MAX_TURNS_PER_POSITION) {
      throw storageError("local session turn history reached the bounded record count");
    }
    let bytes = 0;
    for (const name of names) {
      const stat = await fs.lstat(path.join(turnsDir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw storageError("local session turn history contains a non-regular record");
      }
      bytes += stat.size;
      if (bytes >= MAX_HISTORY_BYTES) {
        throw storageError("local session turn history reached the bounded total size");
      }
    }
  }
}

async function assertRealDirectoryChain(workspace: string, segments: string[]): Promise<void> {
  await assertRealDirectory(workspace, "workspace path is unsafe");
  let current = workspace;
  for (const segment of segments) {
    current = path.join(current, segment);
    await assertRealDirectory(current, "local reports state path is unsafe");
  }
}

async function assertRealDirectory(directory: string, message: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError(message);
}
