import { Empty } from "antd";
import { AlertTriangle, Check, Clock3, RotateCcw, ShieldQuestion } from "lucide-react";
import { engineLabel } from "./TurnPanel";
import type { TurnRecord, TurnStatus } from "./types";

export interface TurnThreadProps {
  turns: TurnRecord[];
  retrying?: boolean;
  canRetry?: (turn: TurnRecord) => boolean;
  onRetry?: (turn: TurnRecord) => void;
}

const STATUS_COPY: Record<TurnStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  indeterminate: "状态未知",
};

function StatusIcon({ status }: { status: TurnStatus }) {
  if (status === "completed") return <Check aria-hidden="true" size={13} />;
  if (status === "running") return <Clock3 aria-hidden="true" size={13} />;
  if (status === "indeterminate") return <ShieldQuestion aria-hidden="true" size={13} />;
  return <AlertTriangle aria-hidden="true" size={13} />;
}

function shortDigest(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

/** Local, append-only turn history. It never infers recall or delegation. */
export function TurnThread({ turns, retrying = false, canRetry, onRetry }: TurnThreadProps) {
  if (turns.length === 0) {
    return (
      <div className="owb-turn-thread owb-turn-thread--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <strong>从一个明确任务开始</strong>
              <p>消息会发送给当前选择的岗位；这里仅展示本地保存的回合。</p>
            </>
          }
        />
      </div>
    );
  }

  return (
    <ol className="owb-turn-thread" aria-label="本地回合历史">
      {turns.map((turn) => {
        const retryable = turn.status === "failed" || turn.status === "indeterminate";
        return (
          <li className="owb-turn" key={turn.id} data-turn-id={turn.id}>
            <article className="owb-turn__request">
              <header>
                <span className="owb-turn__mention">@{turn.positionName}</span>
                <span className="owb-turn__engine">{engineLabel(turn.engine)}</span>
                <time dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString()}</time>
              </header>
              <p className="owb-clamp-2" title={turn.input}>{turn.input}</p>
            </article>

            <article className={`owb-turn__response is-${turn.status}`} aria-live={turn.status === "running" ? "polite" : undefined}>
              <header>
                <span className="owb-turn__status">
                  <StatusIcon status={turn.status} />
                  {STATUS_COPY[turn.status]}
                </span>
                <code title={turn.id}>{turn.id}</code>
              </header>
              {turn.output ? <p className="owb-turn__output owb-clamp-2" title={turn.output}>{turn.output}</p> : null}
              {turn.status === "running" && !turn.output ? (
                <p className="owb-turn__pending owb-clamp-2" title="正在等待岗位完成本回合…">正在等待岗位完成本回合…</p>
              ) : null}
              {turn.error ? <p className="owb-turn__error owb-clamp-2" title={turn.error}>{turn.error}</p> : null}
              {turn.status === "indeterminate" ? (
                <p className="owb-turn__warning owb-clamp-2" title="运行器未返回可信终态。为避免重复执行，系统不会自动重试。">运行器未返回可信终态。为避免重复执行，系统不会自动重试。</p>
              ) : null}

              {turn.envelopeDigest || turn.evidenceDigest ? (
                <dl className="owb-turn__evidence" aria-label="回合证据">
                  {turn.envelopeDigest ? (
                    <div>
                      <dt>Envelope</dt>
                      <dd title={turn.envelopeDigest}>{shortDigest(turn.envelopeDigest)}</dd>
                    </div>
                  ) : null}
                  {turn.evidenceDigest ? (
                    <div>
                      <dt>Evidence</dt>
                      <dd title={turn.evidenceDigest}>{shortDigest(turn.evidenceDigest)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {retryable && onRetry ? (
                <button
                  type="button"
                  className="owb-turn__retry"
                  disabled={retrying || canRetry?.(turn) === false}
                  onClick={() => onRetry(turn)}
                >
                  <RotateCcw aria-hidden="true" size={13} />
                  创建新回合重试
                </button>
              ) : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
