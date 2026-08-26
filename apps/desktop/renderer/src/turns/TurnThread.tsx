import { useEffect, useState } from "react";
import { Empty } from "antd";
import { AlertTriangle, Check, ChevronRight, Clock3, RotateCcw, ShieldAlert, ShieldQuestion } from "lucide-react";
import { engineLabel } from "./TurnPanel";
import { EngineIcon } from "./engine-icon";
import { PositionAvatar } from "../PositionAvatar";
import type { TurnRecord, TurnStatus } from "./types";

export interface TurnThreadProps {
  turns: TurnRecord[];
  retrying?: boolean;
  canRetry?: (turn: TurnRecord) => boolean;
  onRetry?: (turn: TurnRecord) => void;
  /** Operator verdict for a turn settled as engine.approval_required. */
  onVerdict?: (turn: TurnRecord, decision: "granted" | "denied", reason?: string) => void;
  /** Approval ids whose verdict was already dispatched; their cards settle
   * into a decided state so the operator cannot submit duplicate or
   * contradictory verdicts after a history reload. */
  decidedApprovalIds?: ReadonlySet<string>;
  /** Position avatar colors (org-tree deterministic hues; #53/#61). */
  positionColors?: Record<string, string>;
}

const STATUS_COPY: Record<TurnStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  indeterminate: "状态未知",
};

const APPROVAL_KIND_COPY: Record<string, string> = {
  exec: "命令执行",
  write: "写入操作",
  network: "网络访问",
  tool: "工具调用",
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

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const padded = String(seconds % 60).padStart(2, "0");
  return <>{minutes}:{padded}</>;
}

function StatusLine({ turn }: { turn: TurnRecord }) {
  return (
    <p className="owb-turn__statusline">
      <span className="owb-turn__statusline-engine">
        <EngineIcon engine={turn.engine} />
        {engineLabel(turn.engine)}
      </span>
      <span aria-hidden="true">·</span>
      <Elapsed since={turn.createdAt} />
      {turn.totalTokens !== undefined ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{turn.totalTokens} tokens</span>
        </>
      ) : null}
    </p>
  );
}

/** Running bubble typing indicator (#61). The text node stays for screen
 * readers; the animated dots are decorative. */
export function TypingIndicator() {
  return (
    <span className="owb-bubble__typing" role="status">
      <span className="owb-bubble__typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      正在等待岗位完成本回合…
    </span>
  );
}

/** Approval verdict card (#187 Option 1): the verdict always starts a new
 * sealed-envelope resume turn; there is no in-run channel by contract.
 * Rendered embedded inside the employee bubble (#61). */
function ApprovalCard({
  turn,
  busy,
  decided,
  onVerdict,
}: {
  turn: TurnRecord;
  busy: boolean;
  decided: boolean;
  onVerdict: (turn: TurnRecord, decision: "granted" | "denied", reason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const request = turn.approvalRequest;
  if (request === undefined) return null;
  const trimmedReason = reason.trim();
  return (
    <div className="owb-turn__approval" role="group" aria-label="审批请求">
      <p className="owb-turn__approval-title">
        <ShieldAlert aria-hidden="true" size={13} />
        {decided ? "已裁决" : "等待审批"} · {APPROVAL_KIND_COPY[request.kind] ?? request.kind}
      </p>
      <p className="owb-turn__approval-description owb-clamp-2" title={request.description}>
        {request.description}
      </p>
      {request.target ? (
        <p className="owb-turn__approval-target" title={request.target}>{request.target}</p>
      ) : null}
      {request.expiresAt ? (
        <p className="owb-turn__approval-expires">过期时间 {new Date(request.expiresAt).toLocaleString()}</p>
      ) : null}
      {decided ? (
        <p className="owb-turn__approval-decided">裁决已随新回合发出，同一审批不再接受重复裁决</p>
      ) : (
        <>
          <input
            className="owb-turn__approval-reason"
            aria-label="拒绝理由（可选）"
            placeholder="拒绝理由（可选）"
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="owb-turn__approval-actions">
            <button
              type="button"
              className="owb-turn__approval-grant"
              disabled={busy}
              onClick={() => onVerdict(turn, "granted")}
            >
              批准并继续
            </button>
            <button
              type="button"
              className="owb-turn__approval-deny"
              disabled={busy}
              onClick={() => onVerdict(turn, "denied", trimmedReason.length > 0 ? trimmedReason : undefined)}
            >
              拒绝
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Collapsible evidence block (#61): collapsed by default to keep the bubble
 * compact, but the envelope/evidence digests are never dropped — expanding
 * reveals them in full (auditability red line). */
function EvidenceBlock({ turn }: { turn: TurnRecord }) {
  if (!turn.envelopeDigest && !turn.evidenceDigest) return null;
  return (
    <details className="owb-bubble__evidence">
      <summary>
        <ChevronRight aria-hidden="true" size={12} />
        回合证据
      </summary>
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
    </details>
  );
}

/** Local, append-only turn history rendered as a bubble chat (#61): the
 * operator message is a right-aligned bubble; the employee reply is a left
 * bubble carrying avatar + position name + engine label. It never infers
 * recall or delegation. */
export function TurnThread({ turns, retrying = false, canRetry, onRetry, onVerdict, decidedApprovalIds, positionColors }: TurnThreadProps) {
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
          <li className="owb-bubble-turn" key={turn.id} data-turn-id={turn.id}>
            <div className="owb-bubble-row owb-bubble-row--operator">
              <article className="owb-bubble owb-bubble--operator">
                <p className="owb-bubble__text owb-clamp-2" title={turn.input}>{turn.input}</p>
                <footer className="owb-bubble__meta">
                  <time dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString()}</time>
                </footer>
              </article>
            </div>

            <div className="owb-bubble-row owb-bubble-row--employee">
              <PositionAvatar
                colors={positionColors}
                id={turn.positionId}
                name={turn.positionName}
                className="owb-bubble__avatar"
              />
              <article
                className={`owb-bubble owb-bubble--employee is-${turn.status}`}
                aria-live={turn.status === "running" ? "polite" : undefined}
              >
                <header className="owb-bubble__header">
                  <span className="owb-bubble__name">{turn.positionName}</span>
                  <span className="owb-turn__engine">
                    <EngineIcon engine={turn.engine} />
                    {engineLabel(turn.engine)}
                  </span>
                  <span className="owb-turn__status">
                    <StatusIcon status={turn.status} />
                    {STATUS_COPY[turn.status]}
                  </span>
                  <code title={turn.id}>{turn.id}</code>
                </header>

                {turn.status === "running" ? <StatusLine turn={turn} /> : null}
                {turn.output ? <p className="owb-turn__output owb-clamp-2" title={turn.output}>{turn.output}</p> : null}
                {turn.status === "running" && !turn.output ? <TypingIndicator /> : null}
                {turn.error ? <p className="owb-turn__error owb-clamp-2" title={turn.error}>{turn.error}</p> : null}
                {turn.status === "indeterminate" ? (
                  <p className="owb-turn__warning owb-clamp-2" title="运行器未返回可信终态。为避免重复执行，系统不会自动重试。">运行器未返回可信终态。为避免重复执行，系统不会自动重试。</p>
                ) : null}

                <EvidenceBlock turn={turn} />

                {turn.approvalRequest !== undefined && onVerdict ? (
                  <ApprovalCard
                    turn={turn}
                    busy={retrying || canRetry?.(turn) === false}
                    decided={decidedApprovalIds?.has(turn.approvalRequest.approvalId) === true}
                    onVerdict={onVerdict}
                  />
                ) : retryable && onRetry ? (
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
