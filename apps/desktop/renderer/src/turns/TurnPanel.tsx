import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button as AntButton, Input, Select as AntSelect } from "antd";
import { ArrowUp, MessagesSquare, Plus, RefreshCw, Square } from "lucide-react";
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
  /** SSE stream health for the header badge — honest state only: the badge
   * goes dim while reconnecting, it never fakes a live stream. */
  sseConnected?: boolean;
  /** Selected position's mode / per-task budget for the boundary chips
   * (设计稿 .boundaries). Both come straight from /positions/:id; absent
   * means the card has not loaded and the chip shows —, never a guess. */
  selectedMode?: "read_only" | "approval_required" | null;
  selectedBudgetLabel?: string | null;
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
  sseConnected = false,
  selectedMode = null,
  selectedBudgetLabel = null,
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
    await dispatchTurn();
  };

  const dispatchTurn = async (): Promise<void> => {
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
    <section className="owb-turn-panel owb-panel" aria-label="岗位对话">
      <header className="owb-turn-panel__header owb-panel-head">
        <div className="owb-panel-head__main">
          <span className="owb-turn-panel__eyebrow">TURN STREAM · EVIDENCE-FIRST</span>
          <h2>
            <MessagesSquare aria-hidden="true" size={15} />
            本地对话
            {selectedPosition ? (
              <span className="owb-turn-panel__subject">· {selectedPosition.id}</span>
            ) : null}
          </h2>
        </div>
        <div className="owb-panel-head__right">
          <span className="owb-badge owb-badge--ai">
            <span
              className={sseConnected ? "owb-led owb-led--running" : "owb-led owb-led--off"}
              aria-hidden="true"
            />
            SSE
          </span>
        </div>
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

      {sessionMode && selectedSession ? (
        <div className="owb-session-row" aria-label="当前会话">
          <div className="owb-session-chip">
            <span
              className={selectedSession.status === "active" ? "owb-led owb-led--running" : "owb-led owb-led--off"}
              aria-hidden="true"
            />
            <span className="owb-session-chip__kind">session</span>
            <span className="owb-session-chip__id">
              {selectedSession.sessionId.slice(0, 8)} · {selectedSession.status === "active" ? "active" : "只读"}
              {selectedPosition ? ` · ${selectedPosition.id}` : ""}
            </span>
          </div>
        </div>
      ) : null}

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

      {/* 设计稿 .boundaries：host / mode / budget 三枚实况 chip。全部来自
          /health 与 /positions/:id 的事实，缺失即显示 —，不猜。 */}
      <div className="owb-turn-panel__boundaries" aria-label="能力边界">
        <span className="owb-boundary">
          <b>host</b>
          {engineLabel(engine)} — {engineAvailability[engine].ready
            ? "available"
            : engineAvailability[engine].configured
              ? "blocked"
              : "idle"}
        </span>
        <span className="owb-boundary">
          <b>mode</b>
          {selectedMode === null
            ? "—"
            : selectedMode === "read_only"
              ? "read_only · 只读"
              : "approval_required · 需批准"}
        </span>
        <span className="owb-boundary">
          <b>budget</b>
          {selectedBudgetLabel ?? "—"}
        </span>
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
        <label htmlFor="owb-turn-input">下达任务</label>
        <div className="owb-turn-composer__surface">
          <Input.TextArea
            id="owb-turn-input"
            value={input}
            rows={3}
            placeholder={selectedPosition ? `向 @${selectedPosition.name} 下达任务…` : "先选择一个岗位…"}
            disabled={disabledReason !== null}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // ⌘↵ / Ctrl+↵ 发送（提示条声明了这个快捷键，就必须真的能用）。
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void dispatchTurn();
              }
            }}
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
            : disabledReason ?? "⌘↵ 发送 · ⌘. 中断 · 回合只在本机留痕"}
        </p>
      </form>
    </section>
  );
}
