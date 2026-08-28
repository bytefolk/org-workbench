import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button as AntButton, Input, Select as AntSelect } from "antd";
import { ArrowUp, Plus, UserRound, UserRoundPlus, UsersRound } from "lucide-react";
import { PositionAvatar } from "../PositionAvatar";
import { TypingIndicator } from "../turns/TurnThread";
import type { GroupConversation, GroupConversationList, GroupTimeline } from "@org-workbench/shared";
import { engineLabel, engineSelectOptions } from "../turns/TurnPanel";
import { EngineIcon } from "../turns/engine-icon";
import { adaptTurnRecord } from "../turns/adapter";
import type { LiveRunState } from "../turns/turnStream";
import type { PositionMentionOption, TurnEngine, TurnEngineAvailability } from "../turns/types";

export interface GroupsPanelProps {
  workspaceOpen: boolean;
  positions: PositionMentionOption[];
  positionNames: Record<string, string>;
  /** Avatar background colors keyed by position id (metadata.color); positions
   * without one get the same deterministic hue the org tree uses (#53). */
  positionColors?: Record<string, string>;
  /** Prefilled group draft from the org-tree entry (#53, DS-34-001 §1.3):
   * opens the create panel with these members checked. The nonce re-fires
   * repeated entries on the same member set. Explicit draft only — creation
   * still requires the operator to confirm ≥2 members. */
  draftSeed?: { members: string[]; nonce: number } | null;
  engine: TurnEngine;
  engineAvailability: Record<TurnEngine, TurnEngineAvailability>;
  /** Shared SSE projection; group runs carry groupRef and are filtered here. */
  liveRuns: Record<string, LiveRunState>;
  onSelectEngine: (engine: TurnEngine) => void;
  /** 202 spawn list, reported upward so the shared stream seeds live buffers. */
  onSpawnRuns: (
    groupRef: string,
    spawns: Array<{ turnId: string; positionId: string }>,
    input: string,
    engine: TurnEngine,
  ) => void;
}

function groupLabel(group: GroupConversation, names: Record<string, string>): string {
  return group.members.slice(0, 3).map((id) => names[id] ?? id).join("、") +
    (group.members.length > 3 ? ` 等 ${group.members.length} 人` : "");
}

const GROUP_ENGINES: TurnEngine[] = ["qoder", "claude-code", "claude-local"];

/** @mention highlight inside operator bubble text (spec §1/§6). */
function renderMentionText(input: string) {
  return input.split(/(@[\w-]+)/g).map((part, index) =>
    part.startsWith("@") ? (
      <mark key={index} className="owb-mention">{part}</mark>
    ) : (
      part
    ),
  );
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

/** Design-spec §3.2: timestamps read as HH:MM in the mono lane; the full
 * datetime stays reachable through the element's title. */
function timeShort(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "--:--";
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** conversationRef head, mono-stamped in the panel header (设计稿 .g-t span). */
function shortRef(conversationRef: string): string {
  return `${conversationRef.slice(0, 4)}…${conversationRef.slice(-3)}`;
}


/**
 * S2 group chat surface (#52, DS-34-001 rev-1 §1.2): explicit @mention
 * routing spawns one turn per mentioned member — never broadcast. The
 * conversationRef is a workbench-local uuid (缺口① transition debt; cleared
 * when v1alpha2 conversation refs land).
 */
export function GroupsPanel({
  workspaceOpen,
  positions,
  positionNames,
  positionColors,
  draftSeed,
  engine,
  engineAvailability,
  liveRuns,
  onSelectEngine,
  onSpawnRuns,
}: GroupsPanelProps) {
  const [groups, setGroups] = useState<GroupConversation[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const selectedRefRef = useRef<string | null>(null);
  const [timeline, setTimeline] = useState<GroupTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftMembers, setDraftMembers] = useState<ReadonlySet<string>>(new Set());
  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  useEffect(() => {
    selectedRefRef.current = selectedRef;
  }, [selectedRef]);

  const loadGroups = useCallback(async () => {
    if (!workspaceOpen) {
      setGroups([]);
      setSelectedRef(null);
      return;
    }
    try {
      const res = await window.owb.groups();
      if (res.status !== 200) {
        setGroups([]);
        setGroupsError(apiErrorMessage(res.body, "群聊列表读取失败"));
        return;
      }
      const list = res.body as GroupConversationList;
      setGroups(list.groups);
      setGroupsError(null);
      setSelectedRef((current) =>
        current !== null && list.groups.some((group) => group.conversationRef === current)
          ? current
          : list.groups[0]?.conversationRef ?? null,
      );
    } catch {
      setGroupsError("群聊列表读取失败：控制面不可达");
    }
  }, [workspaceOpen]);

  const loadTimeline = useCallback(async (conversationRef: string) => {
    setTimelineLoading(true);
    try {
      const res = await window.owb.groupTimeline(conversationRef);
      if (selectedRefRef.current !== conversationRef) return;
      if (res.status !== 200) {
        setTimeline(null);
        setPanelError(apiErrorMessage(res.body, "群时间线读取失败"));
        return;
      }
      setTimeline(res.body as GroupTimeline);
      setPanelError(null);
    } catch {
      if (selectedRefRef.current === conversationRef) {
        setPanelError("群时间线读取失败：控制面不可达");
      }
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (selectedRef === null) {
      setTimeline(null);
      return;
    }
    setMentions(new Set());
    setInput("");
    void loadTimeline(selectedRef);
  }, [loadTimeline, selectedRef]);

  // Org-tree group entry (#53): seed the draft with known positions only —
  // a stale seed must never check phantom members.
  useEffect(() => {
    if (draftSeed === null || draftSeed === undefined) return;
    const known = draftSeed.members.filter((id) => positions.some((position) => position.id === id));
    if (known.length === 0) return;
    setDraftMembers(new Set(known));
    setCreateOpen(true);
  }, [draftSeed, positions]);

  // Terminal SSE is the refresh hint; the timeline reload is authoritative.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.owb.onEvent((event) => {
      const envelope = event as { type?: string; payload?: unknown };
      if (!["turn.completed", "turn.failed", "turn.indeterminate"].includes(envelope?.type ?? "")) return;
      const payload = envelope.payload as { groupRef?: unknown } | null;
      const groupRef = typeof payload?.groupRef === "string" ? payload.groupRef : null;
      if (groupRef === null || groupRef !== selectedRefRef.current) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void loadTimeline(groupRef), 100);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      off();
    };
  }, [loadTimeline]);

  const selectedGroup = groups.find((group) => group.conversationRef === selectedRef) ?? null;

  const createGroup = useCallback(async () => {
    const members = [...draftMembers];
    if (members.length < 2 || creating) return;
    setCreating(true);
    setPanelError(null);
    try {
      const res = await window.owb.createGroup({ memberPositionIds: members });
      if (res.status !== 201) {
        setPanelError(apiErrorMessage(res.body, "群聊创建失败"));
        return;
      }
      const created = res.body as GroupConversation;
      setDraftMembers(new Set());
      setCreateOpen(false);
      await loadGroups();
      setSelectedRef(created.conversationRef);
    } catch {
      setPanelError("群聊创建失败：控制面不可达");
    } finally {
      setCreating(false);
    }
  }, [creating, draftMembers, loadGroups]);

  const addMember = useCallback(async (positionId: string) => {
    const ref = selectedRefRef.current;
    if (ref === null || !positionId) return;
    try {
      const res = await window.owb.addGroupMember({ conversationRef: ref, positionId });
      if (res.status !== 200) {
        setPanelError(apiErrorMessage(res.body, "拉人失败"));
        return;
      }
      setPanelError(null);
      await loadGroups();
      void loadTimeline(ref);
    } catch {
      setPanelError("拉人失败：控制面不可达");
    }
  }, [loadGroups, loadTimeline]);

  const send = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const ref = selectedRefRef.current;
    const trimmed = input.trim();
    if (ref === null || trimmed.length === 0 || mentions.size === 0 || sending) return;
    setSending(true);
    setPanelError(null);
    try {
      const res = await window.owb.createGroupTurn({
        conversationRef: ref,
        input: trimmed,
        engine,
        mentions: [...mentions],
      });
      if (res.status !== 202) {
        setPanelError(apiErrorMessage(res.body, "群回合创建失败"));
        return;
      }
      const body = res.body as { conversationRef: string; messageId: string; spawns: Array<{ turnId: string; positionId: string }> };
      onSpawnRuns(ref, body.spawns, trimmed, engine);
      setInput("");
      setMentions(new Set());
      void loadTimeline(ref);
    } catch {
      setPanelError("群回合创建失败：控制面不可达");
    } finally {
      setSending(false);
    }
  }, [engine, input, loadTimeline, mentions, onSpawnRuns, sending]);

  /** Merge persisted timeline with live SSE buffers for this group. A run
   * whose turnId is already persisted is suppressed — the record wins. */
  const displayItems = useMemo(() => {
    const persistedTurnIds = new Set(
      timeline?.items.filter((item) => item.kind === "member").map((item) => item.turn.turnId) ?? [],
    );
    const live = Object.entries(liveRuns)
      .filter(([runId, run]) => run.groupRef === selectedRef && !persistedTurnIds.has(runId))
      .map(([runId, run]) => ({
        key: `live-${runId}`,
        turn: {
          id: runId,
          positionId: run.positionId,
          positionName: positionNames[run.positionId] ?? run.positionId,
          engine: run.engine,
          input: run.input,
          status: "running" as const,
          createdAt: run.startedAt,
          ...(run.text !== "" ? { output: run.text } : {}),
          ...(run.totalTokens !== null ? { totalTokens: run.totalTokens } : {}),
        },
      }));
    const persisted = timeline?.items ?? [];
    return { persisted, live };
  }, [liveRuns, positionNames, selectedRef, timeline]);

  /** Members with an in-flight run in this group — drives the roster LED and
   * the header 状态灯 (设计稿 .roster .rdot / .src)。 */
  const runningMembers = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(liveRuns)) {
      if (run.groupRef === selectedRef) ids.add(run.positionId);
    }
    return ids;
  }, [liveRuns, selectedRef]);

  const nonMembers = positions.filter(
    (position) => selectedGroup !== null && !selectedGroup.members.includes(position.id),
  );

  if (!workspaceOpen) {
    return <p className="owb-muted">尚未打开工作区</p>;
  }

  return (
    <section className="owb-groups" aria-label="群聊">
      <div className="owb-groups__list">
        <header className="owb-groups__list-header">
          <h2><UsersRound aria-hidden="true" size={12} />群聊</h2>
        </header>
        {groupsError ? <p className="owb-groups__error" role="alert">{groupsError}</p> : null}
        <ul className="owb-groups__items">
          {groups.map((group) => (
            <li key={group.conversationRef}>
              <button
                type="button"
                className={group.conversationRef === selectedRef ? "is-active" : undefined}
                onClick={() => setSelectedRef(group.conversationRef)}
              >
                <span className="owb-groups__item-name">
                  <span className="owb-groups__avatar-stack" aria-hidden="true">
                    {group.members.slice(0, 3).map((memberId) => (
                      <PositionAvatar
                        key={memberId}
                        colors={positionColors ?? {}}
                        id={memberId}
                        name={positionNames[memberId] ?? memberId}
                        className="owb-groups__avatar owb-groups__avatar--xs"
                      />
                    ))}
                  </span>
                  {groupLabel(group, positionNames)}
                </span>
                <span className="owb-groups__item-meta">
                  {group.members.length} 人 · {timeShort(group.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <details
          className="owb-groups__create"
          open={createOpen}
          onToggle={(event) => setCreateOpen(event.currentTarget.open)}
        >
          <summary><Plus aria-hidden="true" size={13} />新建群聊（≥2 个岗位）</summary>
          <div className="owb-groups__create-body">
            {positions.map((position) => (
              <label key={position.id} className="owb-groups__draft-member">
                <input
                  type="checkbox"
                  checked={draftMembers.has(position.id)}
                  disabled={creating}
                  onChange={(event) => {
                    setDraftMembers((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(position.id);
                      else next.delete(position.id);
                      return next;
                    });
                  }}
                />
                {position.name}
              </label>
            ))}
            <AntButton
              size="small"
              type="primary"
              disabled={draftMembers.size < 2 || creating || positions.length < 2}
              onClick={() => void createGroup()}
            >
              创建群聊
            </AntButton>
          </div>
        </details>
      </div>

      <div className="owb-groups__panel">
        {selectedGroup === null ? (
          <p className="owb-panel__notice">选择或新建一个群聊；@提及决定谁被显式路由。</p>
        ) : (
          <>
            <header className="owb-groups__panel-header">
              <div className="owb-groups__avatar-stack" aria-label={`群成员 ${selectedGroup.members.length} 人`}>
                {selectedGroup.members.slice(0, 6).map((memberId) => (
                  <PositionAvatar
                    key={memberId}
                    colors={positionColors ?? {}}
                    id={memberId}
                    name={positionNames[memberId] ?? memberId}
                    className="owb-groups__avatar"
                  />
                ))}
                {selectedGroup.members.length > 6 ? (
                  <span className="owb-groups__avatar owb-groups__avatar--more">
                    +{selectedGroup.members.length - 6}
                  </span>
                ) : null}
              </div>
              <div className="owb-groups__panel-title">
                <h3>{groupLabel(selectedGroup, positionNames)}</h3>
                <span className="owb-groups__panel-ref">
                  conversation {shortRef(selectedGroup.conversationRef)} · {selectedGroup.members.length} 成员
                </span>
              </div>
              <span className="owb-src">
                <span
                  className={runningMembers.size > 0 ? "owb-led owb-led--running" : "owb-led"}
                  aria-hidden="true"
                />
                <span className="owb-src__text">
                  {runningMembers.size > 0
                    ? `${runningMembers.size} 运行中`
                    : `${selectedGroup.members.length} 在线`}
                </span>
              </span>
            </header>

            <div className="owb-groups__panel-sub">
              <div className="owb-session-chip">
                <span className="owb-session-chip__kind">engine</span>
                <span className="owb-session-chip__id">
                  {engineLabel(engine)} · 群组回合按成员分账
                </span>
              </div>
              <label className="owb-turn-engine">
                <span className="owb-turn-control__label">Agent Host</span>
                <AntSelect
                  aria-label="选择 Agent Host"
                  value={engine}
                  onChange={(next) => onSelectEngine(next as TurnEngine)}
                  options={engineSelectOptions(GROUP_ENGINES, engineAvailability)}
                />
              </label>
            </div>

            {panelError ? <p className="owb-groups__error" role="alert">{panelError}</p> : null}

            <div className="owb-groups__panel-body">
              <aside className="owb-groups__roster" aria-label="群成员">
                <h4>成员</h4>
                <ul className="owb-groups__roster-items">
                  {selectedGroup.members.map((memberId) => {
                    const running = runningMembers.has(memberId);
                    return (
                      <li key={memberId} className="owb-groups__roster-item">
                        <span
                          className={running ? "owb-led owb-led--running" : "owb-led"}
                          {...(running ? { "aria-label": "回合进行中" } : { "aria-hidden": true })}
                        />
                        <PositionAvatar
                          colors={positionColors ?? {}}
                          id={memberId}
                          name={positionNames[memberId] ?? memberId}
                          className="owb-groups__avatar owb-groups__avatar--sm"
                        />
                        <span className="owb-groups__roster-name">{positionNames[memberId] ?? memberId}</span>
                      </li>
                    );
                  })}
                </ul>
                {nonMembers.length > 0 ? (
                  <label className="owb-groups__add-member">
                    <UserRoundPlus aria-hidden="true" size={13} />
                    <AntSelect
                      aria-label="拉人入群"
                      value={undefined}
                      placeholder="拉人…"
                      onChange={(next) => {
                        if (next) void addMember(next);
                      }}
                      options={nonMembers.map((position) => ({
                        value: position.id,
                        label: position.name,
                      }))}
                    />
                  </label>
                ) : null}
              </aside>

              <div className="owb-groups__timeline" aria-label="群时间线" aria-busy={timelineLoading}>
              {displayItems.persisted.map((item) =>
                item.kind === "user" ? (
                  <div className="owb-bubble-turn" key={item.messageId}>
                    {item.mentions.length > 0 ? (
                      <p className="owb-groups__route-note">
                        {item.mentions.map((memberId) => `@${positionNames[memberId] ?? memberId}`).join(" ")}
                        {" "}→ 逐成员 spawn {item.mentions.length} 回合（显式路由，不广播）
                      </p>
                    ) : null}
                    <div className="owb-bubble-row owb-bubble-row--operator">
                      <article className="owb-bubble owb-bubble--operator">
                        <header className="owb-bubble__header">
                          <span className="owb-bubble__avatar owb-bubble__avatar--operator" title="操作员" aria-hidden="true">
                            <UserRound size={11} />
                          </span>
                          <b className="owb-bubble__name">你</b>
                          <span className="owb-bubble__role">操作员</span>
                          <time className="owb-bubble__time" dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
                            {timeShort(item.createdAt)}
                          </time>
                        </header>
                        <p className="owb-bubble__text">{renderMentionText(item.input)}</p>
                      </article>
                    </div>
                  </div>
                ) : (
                  (() => {
                    const turn = adaptTurnRecord(
                      item.turn,
                      positionNames[item.turn.positionId] ?? item.turn.positionId,
                    );
                    return (
                      <div className="owb-bubble-row owb-bubble-row--employee" key={turn.id}>
                        <article className={`owb-bubble owb-bubble--employee is-${turn.status}`}>
                          <header className="owb-bubble__header">
                            <PositionAvatar
                              colors={positionColors}
                              id={turn.positionId}
                              name={turn.positionName}
                              className="owb-bubble__avatar"
                            />
                            <b className="owb-bubble__name">@{turn.positionName}</b>
                            <span className="owb-bubble__eng">
                              <EngineIcon engine={turn.engine} />
                              {engineLabel(turn.engine)}
                            </span>
                            <time className="owb-bubble__time" dateTime={turn.createdAt} title={new Date(turn.createdAt).toLocaleString()}>
                              {timeShort(turn.createdAt)}
                            </time>
                          </header>
                          {turn.output ? (
                            <p className="owb-turn__output owb-clamp-2" title={turn.output}>{turn.output}</p>
                          ) : null}
                          {turn.status === "failed" && turn.error ? (
                            <p className="owb-turn__error owb-clamp-2" title={turn.error}>{turn.error}</p>
                          ) : null}
                          {turn.status === "indeterminate" ? (
                            <p className="owb-turn__warning owb-clamp-2">运行器未返回可信终态；不会自动重试。</p>
                          ) : null}
                        </article>
                      </div>
                    );
                  })()
                ),
              )}
              {displayItems.live.map(({ key, turn }) => (
                <div className="owb-bubble-row owb-bubble-row--employee" key={key} aria-live="polite">
                  <article className="owb-bubble owb-bubble--employee is-running">
                    <header className="owb-bubble__header">
                      <PositionAvatar
                        colors={positionColors}
                        id={turn.positionId}
                        name={turn.positionName}
                        className="owb-bubble__avatar"
                      />
                      <b className="owb-bubble__name">@{turn.positionName}</b>
                      <span className="owb-bubble__eng">
                        <EngineIcon engine={turn.engine} />
                        {engineLabel(turn.engine)}
                      </span>
                      <span className="owb-led owb-led--running" aria-label="回合进行中" />
                    </header>
                    {turn.output ? (
                      <p className="owb-turn__output owb-clamp-2" title={turn.output}>{turn.output}</p>
                    ) : (
                      <TypingIndicator />
                    )}
                  </article>
                </div>
              ))}
              {!timelineLoading && displayItems.persisted.length === 0 && displayItems.live.length === 0 ? (
                <p className="owb-muted">还没有消息；@提及成员并发送，即为显式路由。</p>
              ) : null}
              </div>
            </div>

            <form className="owb-turn-composer owb-groups__composer" onSubmit={(event) => void send(event)}>
              <div className="owb-groups__mention-picker" aria-label="选择要 @ 的成员">
                {selectedGroup.members.map((memberId) => {
                  const active = mentions.has(memberId);
                  return (
                    <button
                      key={memberId}
                      type="button"
                      className={active ? "owb-groups__mention is-active" : "owb-groups__mention"}
                      aria-pressed={active}
                      onClick={() => {
                        setMentions((current) => {
                          const next = new Set(current);
                          if (next.has(memberId)) next.delete(memberId);
                          else next.add(memberId);
                          return next;
                        });
                      }}
                    >
                      @{positionNames[memberId] ?? memberId}
                    </button>
                  );
                })}
              </div>
              <div className="owb-turn-composer__surface">
                <Input.TextArea
                  value={input}
                  rows={3}
                  aria-label="群聊消息"
                  placeholder={mentions.size > 0
                    ? `发送给 ${[...mentions].map((id) => `@${positionNames[id] ?? id}`).join("、")}…`
                    : "按 @ 路由，仅通知被 @ 的成员…"}
                  disabled={sending || !engineAvailability[engine].ready}
                  onChange={(event) => setInput(event.target.value)}
                />
                <AntButton
                  type="primary"
                  htmlType="submit"
                  disabled={sending || input.trim().length === 0 || mentions.size === 0 || !engineAvailability[engine].ready}
                  aria-label="发送群消息"
                  icon={<ArrowUp aria-hidden="true" size={15} />}
                />
              </div>
              <p className="owb-turn-composer__hint" role="status">
                {engineAvailability[engine].ready
                  ? mentions.size === 0
                    ? "显式 @ 路由 —— 只向被提及的成员发起回合，绝不广播"
                    : `将按 @mention 为 ${mentions.size} 名成员各创建一个回合`
                  : engineAvailability[engine].reason ?? `${engineLabel(engine)} 尚未就绪`}
              </p>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
