import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button as AntButton, Input, Select as AntSelect, Tag } from "antd";
import { ArrowUp, Database, GitBranch, MessagesSquare, Plus, RefreshCw, Square } from "lucide-react";
import type { WorkbenchSession } from "@org-workbench/shared";
import { PositionMention } from "./PositionMention";
import { EngineIcon } from "./engine-icon";
import { TurnThread } from "./TurnThread";
import type {
  CreateTurnRequest,
  PositionMentionOption,
  TurnEngine,
  TurnEngineAvailability,
  TurnRecord,
} from "./types";

export interface TurnPanelProps {
  workspaceOpen: boolean;
  positions: PositionMentionOption[];
  selectedPositionId: string | null;
  engine: TurnEngine;
  engineAvailability: Record<TurnEngine, TurnEngineAvailability>;
  turns: TurnRecord[];
  busy?: boolean;
  cancelling?: boolean;
  sessions?: WorkbenchSession[];
  selectedSessionId?: string | null;
  sessionBusy?: boolean;
  onSelectPosition: (positionId: string) => void;
  onSelectEngine: (engine: TurnEngine) => void;
  onCreateTurn: (request: CreateTurnRequest) => void | boolean | Promise<void | boolean>;
  /** Operator interrupt for the in-flight turn of the selected position. */
  onCancelTurn?: (positionId: string) => void | Promise<void>;
  /** Operator verdict for a turn settled as engine.approval_required (#25 Slice B). */
  onVerdictTurn?: (turn: TurnRecord, decision: "granted" | "denied", reason?: string) => void | Promise<void>;
  /** Approval ids whose verdict was already dispatched this session; their
   * cards settle into a decided state (no duplicate verdicts). */
  decidedApprovalIds?: ReadonlySet<string>;
  onSelectSession?: (sessionId: string) => void;
  onCreateSession?: () => void | Promise<void>;
  onRotateSession?: (sessionId: string) => void | Promise<void>;
}

const ENGINE_LABEL: Record<TurnEngine, string> = {
  qoder: "Qoder",
  "claude-code": "Claude Code",
  "claude-local": "Claude Code · 本地登录",
};

export function engineLabel(engine: TurnEngine): string {
  return ENGINE_LABEL[engine];
}

/** antd Select options for the Agent Host pickers (#57): brand icon + label +
 * availability suffix, shared by TurnPanel and GroupsPanel. */
export function engineSelectOptions(
  engines: readonly TurnEngine[],
  engineAvailability: Record<TurnEngine, TurnEngineAvailability>,
) {
  return engines.map((candidate) => ({
    value: candidate,
    label: (
      <span className="owb-engine-option">
        <EngineIcon engine={candidate} />
        {ENGINE_LABEL[candidate]}
        {engineAvailability[candidate].ready
          ? " · Configured"
          : engineAvailability[candidate].configured
            ? " · Blocked"
            : " · Idle"}
      </span>
    ),
  }));
}

export function TurnPanel({
  workspaceOpen,
  positions,
  selectedPositionId,
  engine,
  engineAvailability,
  turns,
  busy = false,
  cancelling = false,
  sessions,
  selectedSessionId = null,
  sessionBusy = false,
  onSelectPosition,
  onSelectEngine,
  onCreateTurn,
  onCancelTurn,
  onVerdictTurn,
  decidedApprovalIds,
  onSelectSession,
  onCreateSession,
  onRotateSession,
}: TurnPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const selectedPosition = positions.find((position) => position.id === selectedPositionId) ?? null;
  const runningTurn = selectedPositionId !== null && turns.some(
    (turn) => turn.positionId === selectedPositionId && turn.status === "running",
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== ".") return;
      if (!runningTurn || cancelling || !selectedPosition) return;
      event.preventDefault();
      void onCancelTurn?.(selectedPosition.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelling, onCancelTurn, runningTurn, selectedPosition]);

  const sessionMode = sessions !== undefined;
  const selectedSession = sessions?.find((session) => session.sessionId === selectedSessionId) ?? null;
  const activeSession = sessions?.find((session) => session.status === "active") ?? null;

  const disabledReason = useMemo(() => {
    if (!workspaceOpen) return "打开工作区后才能开始对话";
    if (positions.length === 0) return "组织中暂无可对话岗位";
    if (!selectedPosition) return "先从组织树或 @ 选择器选择岗位";
    if (sessionMode && !selectedSession) return "请先新建或选择一个会话";
    if (sessionMode && selectedSession?.status !== "active") return "历史会话只读；请选择当前会话";
    if (!engineAvailability[engine].ready) {
      return engineAvailability[engine].reason ?? `${ENGINE_LABEL[engine]} 尚未就绪`;
    }
    if (busy || sending || sessionBusy) return "会话或回合正在更新";
    return null;
  }, [busy, engine, engineAvailability, positions.length, selectedPosition, selectedSession, sending, sessionBusy, sessionMode, workspaceOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabledReason || !selectedPosition) return;
    setSending(true);
    try {
      const created = await onCreateTurn({ positionId: selectedPosition.id, engine, input: trimmed });
      if (created !== false) setInput("");
    } finally {
      setSending(false);
    }
  };

  const retry = async (turn: TurnRecord) => {
    if (busy || sending || !workspaceOpen || !engineAvailability[turn.engine].ready) return;
    setSending(true);
    try {
      await onCreateTurn({
        positionId: turn.positionId,
        engine: turn.engine,
        input: turn.input,
        retryOf: turn.id,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="owb-turn-panel" aria-label="岗位对话">
      <header className="owb-turn-panel__header">
        <div>
          <span className="owb-turn-panel__eyebrow">TURN CONTROL</span>
          <h2>
            <MessagesSquare aria-hidden="true" size={17} />
            {selectedPosition ? `@${selectedPosition.name}` : "@岗位对话"}
          </h2>
        </div>
        <Tag className="owb-turn-panel__history-kind" bordered>本地历史</Tag>
      </header>

      <div className="owb-turn-panel__controls">
        <PositionMention
          positions={positions}
          value={selectedPositionId}
          disabled={!workspaceOpen || positions.length === 0}
          onChange={onSelectPosition}
        />
        <label className="owb-turn-engine">
          <span className="owb-turn-control__label">Agent Host</span>
          <AntSelect
            aria-label="选择 Agent Host"
            value={engine}
            disabled={!workspaceOpen}
            onChange={(next) => onSelectEngine(next as TurnEngine)}
            options={engineSelectOptions(Object.keys(ENGINE_LABEL) as TurnEngine[], engineAvailability)}
          />
        </label>
      </div>

      {sessionMode ? (
        <div className="owb-session-controls" aria-label="岗位会话">
          <label>
            <span className="owb-turn-control__label">本地会话</span>
            <AntSelect
              aria-label="选择本地会话"
              value={selectedSessionId ?? undefined}
              placeholder="尚未创建会话"
              disabled={!workspaceOpen || !selectedPosition || sessionBusy || sessions.length === 0}
              onChange={(next) => {
                if (next) onSelectSession?.(next);
              }}
              options={sessions.map((session, index) => ({
                value: session.sessionId,
                label: `${session.status === "active" ? "当前" : "只读"} · 会话 ${sessions.length - index} · ${session.sessionId.slice(0, 8)}`,
              }))}
            />
          </label>
          {activeSession ? (
            <AntButton
              disabled={sessionBusy || busy}
              onClick={() => void onRotateSession?.(activeSession.sessionId)}
              icon={<RefreshCw aria-hidden="true" size={13} />}
            >
              轮换当前会话
            </AntButton>
          ) : (
            <AntButton
              disabled={!workspaceOpen || !selectedPosition || sessionBusy}
              onClick={() => void onCreateSession?.()}
              icon={<Plus aria-hidden="true" size={13} />}
            >
              新建会话
            </AntButton>
          )}
        </div>
      ) : null}

      <div className="owb-turn-panel__boundaries" aria-label="能力边界">
        <Tag icon={<GitBranch aria-hidden="true" size={13} />} bordered>
          委派链 <strong>Planned</strong>
        </Tag>
        <Tag icon={<Database aria-hidden="true" size={13} />} bordered>
          长期 Context <strong>Planned</strong>
        </Tag>
      </div>

      <TurnThread
        turns={turns}
        retrying={busy || sending}
        canRetry={(turn) => workspaceOpen && engineAvailability[turn.engine].ready && (!sessionMode || selectedSession?.status === "active")}
        onRetry={(turn) => void retry(turn)}
        onVerdict={onVerdictTurn === undefined ? undefined : (turn, decision, reason) => void onVerdictTurn(turn, decision, reason)}
        decidedApprovalIds={decidedApprovalIds}
      />

      <form className="owb-turn-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="owb-turn-input">交办任务</label>
        <div className="owb-turn-composer__surface">
          <Input.TextArea
            id="owb-turn-input"
            value={input}
            rows={3}
            placeholder={selectedPosition ? `交办给 @${selectedPosition.name}…` : "先选择一个岗位…"}
            disabled={disabledReason !== null}
            onChange={(event) => setInput(event.target.value)}
          />
          {runningTurn ? (
            <AntButton
              danger
              disabled={cancelling || !selectedPosition}
              aria-label="中断回合"
              title="中断回合（⌘.）"
              icon={<Square aria-hidden="true" size={15} />}
              onClick={() => {
                if (selectedPosition) void onCancelTurn?.(selectedPosition.id);
              }}
            />
          ) : (
            <AntButton
              type="primary"
              htmlType="submit"
              disabled={disabledReason !== null || input.trim().length === 0}
              aria-label="发送任务"
              icon={<ArrowUp aria-hidden="true" size={15} />}
            />
          )}
        </div>
        <p className="owb-turn-composer__hint" role="status">
          {runningTurn
            ? cancelling
              ? "正在请求控制面中断引擎进程…"
              : "回合运行中：点击中断或按 ⌘. 终止该岗位的在途回合"
            : disabledReason ?? `将通过 ${ENGINE_LABEL[engine]} 创建一个新回合`}
        </p>
      </form>
    </section>
  );
}
