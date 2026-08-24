import { useMemo, useState, type FormEvent } from "react";
import { ArrowUp, Database, GitBranch, MessagesSquare } from "lucide-react";
import { PositionMention } from "./PositionMention";
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
  onSelectPosition: (positionId: string) => void;
  onSelectEngine: (engine: TurnEngine) => void;
  onCreateTurn: (request: CreateTurnRequest) => void | Promise<void>;
}

const ENGINE_LABEL: Record<TurnEngine, string> = {
  qoder: "Qoder",
  "claude-code": "Claude Code",
};

export function TurnPanel({
  workspaceOpen,
  positions,
  selectedPositionId,
  engine,
  engineAvailability,
  turns,
  busy = false,
  onSelectPosition,
  onSelectEngine,
  onCreateTurn,
}: TurnPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const selectedPosition = positions.find((position) => position.id === selectedPositionId) ?? null;

  const disabledReason = useMemo(() => {
    if (!workspaceOpen) return "打开工作区后才能开始对话";
    if (positions.length === 0) return "组织中暂无可对话岗位";
    if (!selectedPosition) return "先从组织树或 @ 选择器选择岗位";
    if (!engineAvailability[engine].ready) {
      return engineAvailability[engine].reason ?? `${ENGINE_LABEL[engine]} 尚未就绪`;
    }
    if (busy || sending) return "正在创建回合";
    return null;
  }, [busy, engine, engineAvailability, positions.length, selectedPosition, sending, workspaceOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabledReason || !selectedPosition) return;
    setSending(true);
    try {
      await onCreateTurn({ positionId: selectedPosition.id, engine, input: trimmed });
      setInput("");
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
        <span className="owb-turn-panel__history-kind">本地历史</span>
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
          <select
            aria-label="选择 Agent Host"
            value={engine}
            disabled={!workspaceOpen}
            onChange={(event) => onSelectEngine(event.target.value as TurnEngine)}
          >
            {(Object.keys(ENGINE_LABEL) as TurnEngine[]).map((candidate) => (
              <option key={candidate} value={candidate}>
                {ENGINE_LABEL[candidate]}
                {engineAvailability[candidate].ready ? " · Ready" : " · Idle"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="owb-turn-panel__boundaries" aria-label="能力边界">
        <span>
          <GitBranch aria-hidden="true" size={13} />
          委派链 <strong>Planned</strong>
        </span>
        <span>
          <Database aria-hidden="true" size={13} />
          长期 Context <strong>Planned</strong>
        </span>
      </div>

      <TurnThread
        turns={turns}
        retrying={busy || sending}
        canRetry={(turn) => workspaceOpen && engineAvailability[turn.engine].ready}
        onRetry={(turn) => void retry(turn)}
      />

      <form className="owb-turn-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="owb-turn-input">交办任务</label>
        <div className="owb-turn-composer__surface">
          <textarea
            id="owb-turn-input"
            value={input}
            rows={3}
            placeholder={selectedPosition ? `交办给 @${selectedPosition.name}…` : "先选择一个岗位…"}
            disabled={disabledReason !== null}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" disabled={disabledReason !== null || input.trim().length === 0} aria-label="发送任务">
            <ArrowUp aria-hidden="true" size={15} />
          </button>
        </div>
        <p className="owb-turn-composer__hint" role="status">
          {disabledReason ?? `将通过 ${ENGINE_LABEL[engine]} 创建一个新回合`}
        </p>
      </form>
    </section>
  );
}
