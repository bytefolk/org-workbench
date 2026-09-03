import { useEffect, useState } from "react";
import { Empty } from "antd";
import { AlertTriangle, Check, Clock3, RotateCcw, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useT } from "@org-workbench/ui";
import { useEngineLabel } from "./TurnPanel";
import { EngineIcon } from "./engine-icon";
import type { TurnRecord, TurnStatus } from "./types";

export interface TurnThreadProps {
  turns: TurnRecord[];
  retrying?: boolean;
  /** #128 AC-002: when no turns exist, the empty-state heading is driven by
   * the caller so it can name the concrete prerequisite (e.g. "先从组织树
   * 或 @ 选择器选择岗位") rather than a generic "start from a clear task"
   * that contradicts the disabled composer hint below. */
  emptyPrompt?: string;
  canRetry?: (turn: TurnRecord) => boolean;
  onRetry?: (turn: TurnRecord) => void;
  /** Operator verdict for a turn settled as engine.approval_required. */
  onVerdict?: (turn: TurnRecord, decision: "granted" | "denied", reason?: string) => void;
  /** Approval ids whose verdict was already dispatched; their cards settle
   * into a decided state so the operator cannot submit duplicate or
   * contradictory verdicts after a history reload. */
  decidedApprovalIds?: ReadonlySet<string>;
}

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

/** Settled-turn duration (completedAt − createdAt), m:ss. */
function settledDuration(turn: TurnRecord): string | null {
  if (turn.status === "running" || !turn.completedAt) return null;
  const ms = new Date(turn.completedAt).getTime() - new Date(turn.createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Status line — 设计稿 §2·③「回合即证据」: engine badge · 耗时 · tokens ·
 * 终态词，mono + tabular-nums。Running turns tick the elapsed counter; settled
 * turns show the sealed duration and a truthful terminal word (可信终态 vs
 * 不确定/失败) — the indeterminate word is never upgraded to a success. */
function StatusLine({ turn }: { turn: TurnRecord }) {
  const t = useT();
  const engineLabel = useEngineLabel();
  const running = turn.status === "running";
  const duration = running ? null : settledDuration(turn);
  return (
    <p className="owb-turn__statusline">
      <span className="owb-turn__statusline-engine">
        <EngineIcon engine={turn.engine} />
        {engineLabel(turn.engine)}
      </span>
      <span aria-hidden="true">·</span>
      {running ? <Elapsed since={turn.createdAt} /> : duration ? <span>{duration}</span> : null}
      {turn.totalTokens !== undefined ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{turn.totalTokens.toLocaleString()} tokens</span>
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      {turn.status === "completed" ? (
        <span className="is-ok">● {t("turn.trusted")}</span>
      ) : turn.status === "running" ? (
        <span className="is-ok">running</span>
      ) : turn.status === "indeterminate" ? (
        <span className="is-bad">▲ {t("turn.untrusted")}</span>
      ) : (
        <span className="is-bad">▲ {t("turn.failed")}</span>
      )}
    </p>
  );
}

/** Evidence stamps — 设计稿 .evidence/.ev: envelope digest + turn id as
 * mono chips. The full digest stays reachable via title/expansion; evidence
 * is never dropped (auditability red line). */
function EvidenceStamps({ turn }: { turn: TurnRecord }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasDigest = Boolean(turn.envelopeDigest) || Boolean(turn.evidenceDigest);
  return (
    <div className="owb-evidence">
      {turn.envelopeDigest ? (
        <button
          type="button"
          className="owb-ev owb-ev--button"
          aria-expanded={open}
          aria-label={open ? t("turn.evCollapse") : t("turn.evExpand")}
          title={turn.envelopeDigest}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="owb-ev__key">envelope</span>
          <kbd>{open ? turn.envelopeDigest : shortDigest(turn.envelopeDigest)}</kbd>
        </button>
      ) : null}
      {turn.evidenceDigest ? (
        <span className="owb-ev" title={turn.evidenceDigest}>
          <span className="owb-ev__key">evidence</span>
          <kbd>{open ? turn.evidenceDigest : shortDigest(turn.evidenceDigest)}</kbd>
        </span>
      ) : null}
      <span className="owb-ev" title={turn.id}>
        <span className="owb-ev__key">turn</span>
        <kbd>{hasDigest ? turn.id.slice(0, 8) : turn.id}</kbd>
      </span>
    </div>
  );
}

/** Running bubble typing indicator (#61, spec ②): three 6px dots, 150ms
 * stagger, 1.05s ease-out loop — 处方4 聊天例外（见 ADR-0007）。Screen-reader
 * copy stays intact. */
export function TypingIndicator() {
  const t = useT();
  return (
    <span className="owb-bubble__typing" role="status">
      <span className="owb-bubble__typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {t("turn.waiting")}
    </span>
  );
}

/** Approval verdict card (#187 Option 1, spec ③): embedded inside the
 * employee bubble; the verdict always starts a new sealed-envelope resume
 * turn — there is no in-run channel by contract. */
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
  const t = useT();
  const kindCopy: Record<string, string> = {
    exec: t("apr.kind.exec"),
    write: t("apr.kind.write"),
    network: t("apr.kind.network"),
    tool: t("apr.kind.tool"),
  };
  const [reason, setReason] = useState("");
  const request = turn.approvalRequest;
  if (request === undefined) return null;
  const trimmedReason = reason.trim();
  return (
    <div className={`owb-turn__approval${decided ? " is-decided" : ""}`} role="group" aria-label={t("apr.request")}>
      <p className="owb-turn__approval-title">
        <ShieldAlert aria-hidden="true" size={13} />
        {decided ? t("apr.decided") : t("apr.pending")} · {kindCopy[request.kind] ?? request.kind}
      </p>
      <p className="owb-turn__approval-description owb-clamp-2" title={request.description}>
        {request.description}
      </p>
      {request.target ? (
        <p className="owb-turn__approval-target" title={request.target}>{request.target}</p>
      ) : null}
      {request.expiresAt ? (
        <p className="owb-turn__approval-expires">{t("apr.expiresAt", { date: new Date(request.expiresAt).toLocaleString() })}</p>
      ) : null}
      {decided ? (
        <p className="owb-turn__approval-decided">{t("apr.decidedNote")}</p>
      ) : (
        <>
          <input
            className="owb-turn__approval-reason"
            aria-label={t("apr.reasonOptional")}
            placeholder={t("apr.reasonOptional")}
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
              {t("apr.grant")}
            </button>
            <button
              type="button"
              className="owb-turn__approval-deny"
              disabled={busy}
              onClick={() => onVerdict(turn, "denied", trimmedReason.length > 0 ? trimmedReason : undefined)}
            >
              {t("apr.deny")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Local, append-only turn history rendered as an evidence timeline
 * (#73 signature move ③「回合即证据」, docs/design/control-plane-v2-preview.html):
 * a guide rail with one state dot per turn (lavender settled / AI-purple
 * breathing while running / danger on failure), each carrying a `.owb-tc`
 * console card — head (position · engine · time), the dispatched task, the
 * engine output, a mono status line, evidence stamps, and the approval card.
 * It never infers recall or delegation, and never upgrades an indeterminate
 * terminal state. (Supersedes the #61 bubble layout for this panel; the
 * `.owb-bubble*` classes stay in use by the group-chat timeline.) */
export function TurnThread({ turns, retrying = false, emptyPrompt, canRetry, onRetry, onVerdict, decidedApprovalIds }: TurnThreadProps) {
  const t = useT();
  const engineLabel = useEngineLabel();
  const statusCopy: Record<TurnStatus, string> = {
    running: t("turn.statusRunning"),
    completed: t("turn.done"),
    failed: t("turn.failed"),
    indeterminate: t("turn.statusUnknown"),
  };
  if (turns.length === 0) {
    return (
      <div className="owb-turn-thread owb-turn-thread--empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <strong>{emptyPrompt ?? t("turn.emptyStart")}</strong>
          }
        />
      </div>
    );
  }

  return (
    <ol className="owb-turn-thread" role="log" aria-live="polite" aria-label={t("turn.threadAria")}>
      {turns.map((turn) => {
        const retryable = turn.status === "failed" || turn.status === "indeterminate";
        const stateClass =
          turn.status === "running"
            ? "is-running"
            : turn.status === "failed"
              ? "is-failed"
              : turn.status === "indeterminate"
                ? "is-indeterminate"
                : "";
        return (
          <li className={`owb-turn ${stateClass}`} key={turn.id} data-turn-id={turn.id}>
            {/* #248 R2 ④：D3 升级为对话界面——操作员下达（右）与岗位回复（左）成对成线程。 */}
            <div className="owb-bubble-row owb-bubble-row--operator">
              <article className="owb-bubble owb-bubble--operator">
                <p className="owb-bubble__text owb-clamp-2" title={turn.input}>{turn.input}</p>
              </article>
            </div>
            <div className="owb-bubble-row owb-bubble-row--employee">
            <article
              className={`owb-bubble owb-bubble--employee owb-tc ${stateClass}`}
              aria-live={turn.status === "running" ? "polite" : undefined}
            >
              <header className="owb-tc-head">
                <span className="owb-tc-head__who" title={turn.positionId}>
                  {turn.positionName}
                </span>
                <span className="owb-tc-head__eng">
                  <EngineIcon engine={turn.engine} />
                  {engineLabel(turn.engine)}
                </span>
                <span className="owb-turn__status">
                  <StatusIcon status={turn.status} />
                  {statusCopy[turn.status]}
                </span>
                <time className="owb-tc-head__time" dateTime={turn.createdAt}>
                  {new Date(turn.createdAt).toLocaleTimeString()}
                </time>
              </header>

              {turn.output ? (
                <p className="owb-tc__out owb-clamp-2" title={turn.output}>{turn.output}</p>
              ) : null}
              {turn.status === "running" && !turn.output ? <TypingIndicator /> : null}

              <StatusLine turn={turn} />

              {turn.error ? (
                <div className="owb-bubble__error owb-clamp-2" title={turn.error}>{turn.error}</div>
              ) : null}
              {turn.status === "indeterminate" ? (
                <p className="owb-turn__warning owb-clamp-2" title={t("turn.untrustedWarning")}>
                  <ShieldQuestion aria-hidden="true" size={13} />
                  {t("turn.untrustedWarning")}
                </p>
              ) : null}

              <EvidenceStamps turn={turn} />

              {turn.approvalRequest !== undefined && onVerdict ? (
                <ApprovalCard
                  turn={turn}
                  busy={retrying || canRetry?.(turn) === false}
                  decided={decidedApprovalIds?.has(turn.approvalRequest.approvalId) === true}
                  onVerdict={onVerdict}
                />
              ) : null}

              {turn.approvalRequest === undefined && retryable && onRetry ? (
                <div className="owb-bubble__retryrow">
                  <button
                    type="button"
                    className="owb-turn__retry"
                    disabled={retrying || canRetry?.(turn) === false}
                    onClick={() => onRetry(turn)}
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                    {t("turn.retry")}
                  </button>
                </div>
              ) : null}
            </article>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
