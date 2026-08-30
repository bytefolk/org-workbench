import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button as AntButton, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppShell,
  ModuleRail,
  Sidebar,
  Skeleton,
  Topbar,
} from "@fullstack-ai-infra/ui";
import { OrgTree, PositionCard } from "@org-workbench/ui";
import type { OrgDropPosition, PositionCardData } from "@org-workbench/ui";
import type {
  ChangeManifest,
  HealthResponse,
  OrgBackupEntry,
  OrgBackupsResponse,
  OrgTreeNodeV1,
  OrgTreeSnapshot,
  PositionMode,
  ReportsResponse,
  TurnHistory,
  WorkbenchSession,
  WorkbenchSessionList,
  WorkspaceInfoResponse,
} from "@org-workbench/shared";
import { FileChartColumn, FolderTree, History, Network, Plus, UsersRound } from "lucide-react";
import {
  EMPTY_TURN_STREAM,
  TurnPanel,
  adaptTurnHistory,
  adaptTurnRecord,
  applyTurnEvent,
  approvalResumeInput,
  beginGroupRun,
  beginPendingTurn,
  cancelPendingTurn,
  resetStreamSeq,
  settlePendingTurn,
} from "./turns";
import type {
  CreateTurnRequest,
  PositionMentionOption,
  TurnEngine,
  TurnRecord,
  TurnStreamEnvelope,
  TurnStreamState,
} from "./turns";
import { BackupTray, DismissPositionDialog } from "./org/OrgControls";
import { HireDrawer } from "./org/HireDrawer";
import { OrgChart } from "./org/OrgChart";
import { GroupsPanel } from "./groups/GroupsPanel";
import { DocsModule } from "./docs/DocsModule";
import { ReportsCenter } from "./reports/ReportsCenter";

interface PositionCardState {
  loading: boolean;
  data: PositionCardData | null;
  notFound: boolean;
}

/**
 * D1 renderer: AppShell four-zone layout (spec §1) — ModuleRail (org active,
 * memory/docs placeholders), Topbar (breadcrumbs + engine status + budget
 * summary), Sidebar (--ui-sidebar-wide 288px, OrgTree), main (PositionCard).
 * Data flows exclusively through the whitelisted preload bridge + SSE
 * (org.updated drives refresh; the UI never polls).
 */
export function App() {
  const [activeModule, setActiveModule] = useState<"org" | "groups" | "reports" | "docs">("org");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfoResponse | null>(null);
  const [snapshot, setSnapshot] = useState<OrgTreeSnapshot | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [card, setCard] = useState<PositionCardState>({
    loading: false,
    data: null,
    notFound: false,
  });
  const [positionNames, setPositionNames] = useState<Record<string, string>>({});
  const positionNamesRef = useRef<Record<string, string>>({});
  const [positionColors, setPositionColors] = useState<Record<string, string>>({});
  /** P0 组织图：mode / title 展示面按岗位 id（来自 refresh 已在做的
   * /positions/:id 读取，与侧栏树 displayNames 同源；不新增 IPC 调用）。 */
  const [positionModes, setPositionModes] = useState<Record<string, PositionMode>>({});
  const [positionTitles, setPositionTitles] = useState<Record<string, string>>({});
  const [turnEngine, setTurnEngine] = useState<TurnEngine>("qoder");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [turnStream, setTurnStream] = useState<TurnStreamState>(EMPTY_TURN_STREAM);
  const [turnBusy, setTurnBusy] = useState(false);
  const [turnCancelling, setTurnCancelling] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkbenchSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sseState, setSseState] = useState<"connecting" | "connected">("connecting");
  const [backups, setBackups] = useState<OrgBackupEntry[]>([]);
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgFeedback, setOrgFeedback] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  /** Approvals whose verdict was already sealed into a resume turn. The
   * server record never persists pendingApproval, so this client-side set is
   * the only source for settling the verdict card into a terminal state. */
  const [decidedApprovals, setDecidedApprovals] = useState<ReadonlySet<string>>(new Set());
  /** Tree-node "+" hire entry (#32 AC-004): undefined = closed, otherwise the preset reportTo. */
  const [treeHireParent, setTreeHireParent] = useState<string | null | undefined>(undefined);
  /** Org-tree group entry (#53): prefilled draft members handed to the
   * GroupsPanel create panel; nonce re-fires repeated entries. */
  const [groupDraftSeed, setGroupDraftSeed] = useState<{ members: string[]; nonce: number } | null>(null);
  /** 亮/暗跟随 <html data-theme>，antd cssinjs 与 --ui-* skin 同步切换。 */
  const themeMode = useThemeMode();

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadBackups = useCallback(async () => {
    const response = await window.owb.orgBackups();
    if (response.status === 200) setBackups((response.body as OrgBackupsResponse).backups);
    else setBackups([]);
  }, []);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const response = await window.owb.reports();
      if (response.status !== 200) {
        setReports(null);
        setReportsError(apiErrorMessage(response.body, "上报数据读取失败"));
        return;
      }
      setReports(response.body as ReportsResponse);
      setReportsError(null);
    } catch {
      setReports(null);
      setReportsError("上报数据读取失败：控制面不可达");
    } finally {
      setReportsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [statusRes, workspaceRes] = await Promise.all([
      window.owb.status(),
      window.owb.workspace(),
    ]);
    setHealth(statusRes.health ?? null);
    const ws = workspaceRes.body as WorkspaceInfoResponse | null;
    setWorkspaceInfo(ws);
    if (ws?.open === true) {
      const treeRes = await window.owb.orgTree();
      if (treeRes.status === 200) {
        const nextSnapshot = treeRes.body as OrgTreeSnapshot;
        setSnapshot(nextSnapshot);
        const positionIds = flattenPositionIds(nextSnapshot.tree);
        setSelectedId((current) => current && positionIds.includes(current) ? current : null);
        const cardEntries = await Promise.all(positionIds.map(async (id): Promise<[string, { name: string; color?: string; mode?: PositionMode; title?: string }]> => {
          const response = await window.owb.position(id);
          const body = response.body as { position?: PositionCardData };
          const position = response.status === 200 ? body.position : undefined;
          const color = position?.metadata?.color;
          const title = position?.metadata?.title;
          return [id, {
            name: position?.name ?? id,
            ...(typeof color === "string" && color.length > 0 ? { color } : {}),
            ...(position ? { mode: position.mode } : {}),
            ...(typeof title === "string" && title.length > 0 ? { title } : {}),
          }];
        }));
        const names = Object.fromEntries(cardEntries.map(([id, entry]) => [id, entry.name]));
        positionNamesRef.current = names;
        setPositionNames(names);
        setPositionColors(Object.fromEntries(cardEntries.filter(([, entry]) => "color" in entry).map(([id, entry]) => [id, (entry as { color: string }).color])));
        setPositionModes(Object.fromEntries(cardEntries.filter(([, entry]) => entry.mode !== undefined).map(([id, entry]) => [id, entry.mode as PositionMode])));
        setPositionTitles(Object.fromEntries(cardEntries.filter(([, entry]) => entry.title !== undefined).map(([id, entry]) => [id, entry.title as string])));
        await Promise.all([loadBackups(), loadReports()]);
      } else {
        setSnapshot(null);
        positionNamesRef.current = {};
        setPositionNames({});
        setPositionColors({});
        setPositionModes({});
        setPositionTitles({});
      }
    } else {
      setSnapshot(null);
      positionNamesRef.current = {};
      setPositionNames({});
      setPositionColors({});
      setPositionModes({});
      setPositionTitles({});
      setSelectedId(null);
      setCard({ loading: false, data: null, notFound: false });
      setTurns([]);
      setTurnStream(EMPTY_TURN_STREAM);
      setSessions([]);
      setSelectedSessionId(null);
      selectedSessionIdRef.current = null;
      setTurnError(null);
      setDecidedApprovals(new Set());
      setBackups([]);
      setReports(null);
      setReportsError(null);
    }
    setTreeLoading(false);
  }, [loadBackups, loadReports]);

  const loadPosition = useCallback(async (id: string) => {
    setCard({ loading: true, data: null, notFound: false });
    const res = await window.owb.position(id);
    if (selectedIdRef.current !== id) return;
    const body = res.body as { position?: PositionCardData; code?: string };
    if (res.status === 404 || body?.code === "position_missing") {
      setCard({ loading: false, data: null, notFound: true });
      return;
    }
    setCard({ loading: false, data: body?.position ?? null, notFound: false });
  }, []);

  const loadTurnHistory = useCallback(async (id: string) => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId === null) {
      setTurns([]);
      return true;
    }
    try {
      const res = await window.owb.sessionTurnHistory(sessionId);
      if (selectedIdRef.current !== id || selectedSessionIdRef.current !== sessionId) return false;
      if (res.status !== 200) {
        setTurnError(apiErrorMessage(res.body, "本地历史读取失败"));
        return false;
      }
      const history = res.body as TurnHistory;
      setTurns(adaptTurnHistory(history, positionNamesRef.current[id] ?? id));
      setTurnError(null);
      return true;
    } catch {
      if (selectedIdRef.current === id && selectedSessionIdRef.current === sessionId) {
        setTurnError("本地历史读取失败：控制面不可达");
      }
      return false;
    }
  }, []);

  const loadSessions = useCallback(async (id: string) => {
    try {
      const res = await window.owb.sessions(id);
      if (selectedIdRef.current !== id) return false;
      if (res.status !== 200) {
        setSessions([]);
        setSelectedSessionId(null);
        selectedSessionIdRef.current = null;
        setTurnError(apiErrorMessage(res.body, "会话列表读取失败"));
        return false;
      }
      const list = res.body as WorkbenchSessionList;
      setSessions(list.sessions);
      const current = selectedSessionIdRef.current;
      const next = current && list.sessions.some((session) => session.sessionId === current)
        ? current
        : list.activeSessionId;
      selectedSessionIdRef.current = next;
      setSelectedSessionId(next);
      setTurnError(null);
      return true;
    } catch {
      if (selectedIdRef.current === id) setTurnError("会话列表读取失败：控制面不可达");
      return false;
    }
  }, []);

  useEffect(() => {
    if (workspaceInfo?.open !== true || selectedId === null) {
      setCard({ loading: false, data: null, notFound: false });
      setTurns([]);
      setSessions([]);
      setSelectedSessionId(null);
      selectedSessionIdRef.current = null;
      setTurnError(null);
      return;
    }
    setTurns([]);
    setTurnError(null);
    void loadPosition(selectedId);
    void loadSessions(selectedId);
  }, [loadPosition, loadSessions, selectedId, workspaceInfo?.open, workspaceInfo?.path]);

  useEffect(() => {
    if (workspaceInfo?.open === true && selectedId !== null) void loadTurnHistory(selectedId);
  }, [loadTurnHistory, selectedId, selectedSessionId, workspaceInfo?.open]);

  useEffect(() => {
    void refresh();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const offEvent = window.owb.onEvent((event) => {
      const envelope = event as { type?: string };
      if (envelope?.type === "org.updated") {
        void refresh();
        return;
      }
      if (typeof envelope?.type === "string" && envelope.type.startsWith("turn.")) {
        setTurnStream((current) => applyTurnEvent(current, envelope as TurnStreamEnvelope));
      }
      if (["turn.completed", "turn.failed", "turn.indeterminate"].includes(envelope?.type ?? "")) {
        void loadReports();
        const id = selectedIdRef.current;
        if (id !== null) {
          if (refreshTimer !== null) clearTimeout(refreshTimer);
          // Terminal SSE is emitted immediately before the server-owned record
          // is finalized. A short coalescing delay makes SSE a refresh hint;
          // the blocking POST readback below remains the source of truth.
          refreshTimer = setTimeout(() => void loadTurnHistory(id), 100);
        }
      }
    });
    const applySseStatus = (state: "connecting" | "connected") => {
      setSseState(state);
      // A reconnect restarts the server-side seq space; drop the replay guard
      // so new events are not suppressed by a stale high-water mark.
      if (state === "connecting") setTurnStream((current) => resetStreamSeq(current));
    };
    const offSse = window.owb.onSseStatus(applySseStatus);
    void window.owb.sseStatus().then(applySseStatus);
    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      offEvent();
      offSse();
    };
  }, [loadReports, loadTurnHistory, refresh]);

  const selectPosition = useCallback((id: string) => {
    selectedIdRef.current = id;
    selectedSessionIdRef.current = null;
    setSelectedSessionId(null);
    setSessions([]);
    setTurns([]);
    setSelectedId(id);
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setTurns([]);
    setTurnStream(EMPTY_TURN_STREAM);
    setTurnError(null);
  }, []);

  const createSession = useCallback(async () => {
    const positionId = selectedIdRef.current;
    if (positionId === null) return;
    setSessionBusy(true);
    setTurnError(null);
    try {
      const res = await window.owb.createSession({ positionId });
      if (res.status !== 201) {
        setTurnError(apiErrorMessage(res.body, "新建会话失败"));
        return;
      }
      const session = res.body as WorkbenchSession;
      selectedSessionIdRef.current = session.sessionId;
      setSelectedSessionId(session.sessionId);
      await loadSessions(positionId);
    } catch {
      setTurnError("新建会话失败：控制面不可达");
    } finally {
      setSessionBusy(false);
    }
  }, [loadSessions]);

  const rotateSession = useCallback(async (sessionId: string) => {
    const positionId = selectedIdRef.current;
    if (positionId === null) return;
    setSessionBusy(true);
    setTurnError(null);
    try {
      const res = await window.owb.rotateSession(sessionId);
      if (res.status !== 200 && res.status !== 201) {
        setTurnError(apiErrorMessage(res.body, "轮换会话失败"));
        return;
      }
      const session = res.body as WorkbenchSession;
      selectedSessionIdRef.current = session.sessionId;
      setSelectedSessionId(session.sessionId);
      setTurns([]);
      setTurnStream(EMPTY_TURN_STREAM);
      await loadSessions(positionId);
    } catch {
      setTurnError("轮换会话失败：控制面不可达");
    } finally {
      setSessionBusy(false);
    }
  }, [loadSessions]);

  const createTurn = useCallback(async (request: CreateTurnRequest) => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId === null) {
      setTurnError("请先新建或选择当前会话");
      return false;
    }
    setTurnBusy(true);
    setTurnError(null);
    setTurnStream((current) =>
      beginPendingTurn(current, {
        positionId: request.positionId,
        engine: request.engine,
        input: request.input,
      }),
    );
    try {
      const res = await window.owb.createSessionTurn({
        sessionId,
        engine: request.engine,
        input: request.input,
        ...(request.pendingApproval !== undefined
          ? { pendingApproval: request.pendingApproval }
          : {}),
      });
      if (res.status !== 200) {
        const message = apiErrorMessage(res.body, "回合创建失败");
        setTurnError(message);
        setTurnStream((current) => cancelPendingTurn(current));
        return false;
      }
      if (selectedIdRef.current === request.positionId) {
        const returned = adaptTurnRecord(
          res.body,
          positionNamesRef.current[request.positionId] ?? request.positionId,
        );
        setTurns((current) => replaceTurn(current, returned));
      }
      const body = res.body as { runId?: unknown };
      setTurnStream((current) =>
        settlePendingTurn(current, {
          runId: typeof body.runId === "string" ? body.runId : null,
          positionId: request.positionId,
        }),
      );
      await loadTurnHistory(request.positionId);
      return true;
    } catch {
      setTurnStream((current) => cancelPendingTurn(current));
      setTurnError("回合创建失败：控制面不可达");
      return false;
    } finally {
      setTurnBusy(false);
    }
  }, [loadTurnHistory]);

  /** Group spawn (#52): the 202 spawn list carries pre-assigned turnIds; seed
   * one live buffer per mentioned member so SSE deltas aggregate per member. */
  const spawnGroupRuns = useCallback(
    (
      groupRef: string,
      spawns: Array<{ turnId: string; positionId: string }>,
      input: string,
      engine: TurnEngine,
    ) => {
      setTurnStream((current) =>
        spawns.reduce(
          (state, spawn) =>
            beginGroupRun(state, { groupRef, turnId: spawn.turnId, positionId: spawn.positionId, engine, input }),
          current,
        ),
      );
    },
    [],
  );

  /** Operator cancel (issue #25 Slice A): the control plane settles the turn
   * as indeterminate/turn_cancelled; the in-flight POST readback and the
   * history reload remain the only authorities for the final record. */
  const cancelTurn = useCallback(async (positionId: string) => {
    setTurnCancelling(true);
    setTurnError(null);
    try {
      const res = await window.owb.cancelTurn(positionId);
      if (res.status !== 200) {
        setTurnError(apiErrorMessage(res.body, "中断请求被拒绝"));
      }
    } catch {
      setTurnError("中断请求失败：控制面不可达");
    } finally {
      setTurnCancelling(false);
    }
  }, []);

  /** Operator verdict (issue #25 Slice B): the verdict is a new resume turn
   * whose sealed envelope carries pendingApproval; granted defaults scope to
   * "once" upstream, denied carries the optional reason only. A verdict is
   * only marked decided after the resume turn is created, so a failed
   * creation leaves the card actionable. */
  const verdictTurn = useCallback(
    async (turn: TurnRecord, decision: "granted" | "denied", reason?: string) => {
      const request = turn.approvalRequest;
      if (request === undefined) return;
      if (decidedApprovals.has(request.approvalId)) return;
      const created = await createTurn({
        positionId: turn.positionId,
        engine: turn.engine,
        input: approvalResumeInput(decision, reason),
        pendingApproval: {
          approvalId: request.approvalId,
          decision,
          decidedBy: "operator",
          ...(decision === "granted" ? { scope: "once" as const } : {}),
          ...(reason !== undefined ? { reason } : {}),
        },
      });
      if (created !== false) {
        setDecidedApprovals((current) => new Set(current).add(request.approvalId));
      }
    },
    [createTurn, decidedApprovals],
  );

  const openWorkspace = useCallback(async () => {
    await window.owb.openWorkspace();
    await refresh();
  }, [refresh]);

  const applyOrg = useCallback(async (manifest: ChangeManifest, successMessage: string) => {
    setOrgBusy(true);
    setOrgFeedback(null);
    try {
      const response = await window.owb.orgApply(manifest);
      if (response.status !== 200) {
        setOrgFeedback({ tone: "warn", text: apiErrorMessage(response.body, "组织变更被拒绝；应用态未更新，提案保留可修正") });
        return false;
      }
      setOrgFeedback({ tone: "info", text: successMessage });
      await refresh();
      return true;
    } catch {
      setOrgFeedback({ tone: "warn", text: "组织变更状态不确定：控制面不可达；不会自动重试" });
      return false;
    } finally {
      setOrgBusy(false);
    }
  }, [refresh]);

  const movePosition = useCallback(async (id: string, reportTo: string | null) => {
    if (!snapshot) return false;
    if (id === snapshot.owner) {
      setOrgFeedback({ tone: "warn", text: "企业负责人不能通过拖拽调岗" });
      return false;
    }
    const source = findNodeById(snapshot.tree, id);
    if (!source) {
      setOrgFeedback({ tone: "warn", text: `岗位 ${id} 已不在当前应用态，请刷新后重试` });
      return false;
    }
    if (source.reportTo === reportTo) {
      setOrgFeedback({ tone: "info", text: "汇报线没有变化，无需应用" });
      return false;
    }
    if (reportTo === id || (reportTo !== null && containsNode(source, reportTo))) {
      setOrgFeedback({ tone: "warn", text: "非法投放：岗位不能汇报给自己或自己的下属" });
      return false;
    }
    return applyOrg({ schemaVersion: "change-manifest.v1", changes: [{ op: "move", id, reportTo }] }, `已将 ${id} 调整到 ${reportTo ?? "企业根"}`);
  }, [applyOrg, snapshot]);

  /** #33: hire is the only creation channel; success linkage = refresh + select the new node. */
  const hiredPosition = useCallback(async (positionId: string, name: string) => {
    setOrgFeedback({ tone: "info", text: `${name} 已加入团队（hire-request.v1alpha1 契约面）` });
    await refresh();
    setSelectedId(positionId);
  }, [refresh]);

  const dismissPosition = useCallback(async (id: string) =>
    applyOrg({ schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id }] }, `已裁撤 ${id}；目录保留在恢复区`), [applyOrg]);

  /** Same-level insertion from an insertion-line drop or ⌘↑/⌘↓ (#32): the
   * reorder op carries the final sibling order; a cross-parent insertion is
   * submitted atomically as move + reorder in one manifest. */
  const reorderPosition = useCallback(async (drop: OrgDropPosition) => {
    if (!snapshot) return false;
    const source = findNodeById(snapshot.tree, drop.id);
    if (!source) {
      setOrgFeedback({ tone: "warn", text: `岗位 ${drop.id} 已不在当前应用态，请刷新后重试` });
      return false;
    }
    if (source.reportTo === drop.parentId) {
      const current = source.reportTo === null
        ? snapshot.tree.map((node) => node.id)
        : findNodeById(snapshot.tree, source.reportTo)?.children.map((node) => node.id) ?? [];
      if (current.join("\u0000") === drop.order.join("\u0000")) {
        setOrgFeedback({ tone: "info", text: "顺序没有变化，无需应用" });
        return false;
      }
      return applyOrg(
        { schemaVersion: "change-manifest.v1", changes: [{ op: "reorder", parentId: drop.parentId, order: drop.order }] },
        `已调整 ${drop.id} 的同级顺序`,
      );
    }
    return applyOrg(
      {
        schemaVersion: "change-manifest.v1",
        changes: [
          { op: "move", id: drop.id, reportTo: drop.parentId },
          { op: "reorder", parentId: drop.parentId, order: drop.order },
        ],
      },
      `已将 ${drop.id} 调整到 ${drop.parentId ?? "企业根"}`,
    );
  }, [applyOrg, snapshot]);

  /** Single-step undo of the last drag adjustment (#32 AC-005). Structural
   * add/delete restores stay with BackupTray; 404 means nothing is undoable. */
  const undoLastAdjustment = useCallback(async () => {
    setOrgBusy(true);
    setOrgFeedback(null);
    try {
      const response = await window.owb.orgUndo();
      if (response.status === 404) {
        setOrgFeedback({ tone: "info", text: "没有可撤销的组织调整" });
        return false;
      }
      if (response.status !== 200) {
        setOrgFeedback({ tone: "warn", text: apiErrorMessage(response.body, "撤销被拒绝") });
        return false;
      }
      setOrgFeedback({ tone: "info", text: "已撤销最近一次组织调整" });
      await refresh();
      return true;
    } catch {
      setOrgFeedback({ tone: "warn", text: "撤销状态不确定：控制面不可达；不会自动重试" });
      return false;
    } finally {
      setOrgBusy(false);
    }
  }, [refresh]);

  const restorePosition = useCallback(async (backupId: string) => {
    setOrgBusy(true);
    setOrgFeedback(null);
    try {
      const response = await window.owb.orgRestore(backupId);
      if (response.status !== 200) {
        setOrgFeedback({ tone: "warn", text: apiErrorMessage(response.body, "恢复被拒绝") });
        return false;
      }
      const body = response.body as { positionId: string; restored: boolean };
      setOrgFeedback({ tone: "info", text: body.restored ? `已恢复 ${body.positionId}` : `${body.positionId} 已在应用态，无需重复恢复` });
      await refresh();
      return true;
    } catch {
      setOrgFeedback({ tone: "warn", text: "恢复状态不确定：控制面不可达；不会自动重试" });
      return false;
    } finally {
      setOrgBusy(false);
    }
  }, [refresh]);

  const engineOk = health?.engine?.available === true;
  /** The frozen org-tree.v1 carries ids/budgets only; display names and modes
   * arrive via the selected position card (/positions/:id). */
  const selectedPosition = card.data;
  const positions = useMemo<PositionMentionOption[]>(() => {
    if (!snapshot) return [];
    return flattenPositionIds(snapshot.tree).map((id) => ({ id, name: positionNames[id] ?? id }));
  }, [positionNames, snapshot]);
  const selectedNode = selectedId && snapshot ? findNodeById(snapshot.tree, selectedId) : null;
  const selectedBudgetReport = selectedId ? reports?.budgets.find((budget) => budget.positionId === selectedId) : null;
  const selectedBudgetRatio = selectedBudgetReport?.latestTurn && selectedBudgetReport.declared.perTask.tokens
    ? selectedBudgetReport.latestTurn.totalTokens / selectedBudgetReport.declared.perTask.tokens
    : null;

  /** Position ids with a turn in flight — drives the tree/card status lights
   * (#73 signature move ②). Observed from the SSE run stream only; a position
   * with no live run is never shown as running. */
  const runningPositionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(turnStream.runs)) {
      if (run.positionId) ids.add(run.positionId);
    }
    return ids;
  }, [turnStream.runs]);

  /** Per-position per-task consumption ratios for the tree's micro budget
   * bars. Only positions with a real latest-turn fact get a ratio; the rest
   * stay in declaration phase rather than rendering a fabricated 0%. */
  const budgetRatios = useMemo(() => {
    const ratios: Record<string, number | null> = {};
    for (const budget of reports?.budgets ?? []) {
      const cap = budget.declared.perTask.tokens;
      ratios[budget.positionId] = budget.latestTurn && cap
        ? budget.latestTurn.totalTokens / cap
        : null;
    }
    return ratios;
  }, [reports]);
  const engineAvailability = useMemo(() => ({
    qoder: {
      configured: health?.hosts?.qoder.configured === true,
      ready: health?.hosts?.qoder.ready === true,
      reason: health?.hosts?.qoder.nextStep ?? "Qoder Host 配置状态不可用",
    },
    "claude-code": {
      configured: health?.hosts?.["claude-code"].configured === true,
      ready: health?.hosts?.["claude-code"].ready === true,
      reason: health?.hosts?.["claude-code"].nextStep ?? "Claude Code Host 配置状态不可用",
    },
    "claude-local": {
      configured: health?.hosts?.["claude-local"]?.configured === true,
      ready: health?.hosts?.["claude-local"]?.ready === true,
      reason: health?.hosts?.["claude-local"]?.nextStep ?? "Claude Code（本地登录）Host 探测状态不可用",
    },
  }), [health]);

  const displayTurns = useMemo(() => {
    const historyRunIds = new Set(turns.flatMap((turn) => (turn.runId ? [turn.runId] : [])));
    const live: TurnRecord[] = selectedId === null
      ? []
      : Object.entries(turnStream.runs)
          .filter(([runId, run]) => run.groupRef === undefined && run.positionId === selectedId && !historyRunIds.has(runId))
          .map(([runId, run]) => ({
            id: `live-${runId}`,
            positionId: run.positionId,
            positionName: positionNames[run.positionId] ?? run.positionId,
            engine: run.engine,
            input: run.input,
            status: "running" as const,
            createdAt: run.startedAt,
            ...(run.text !== "" ? { output: run.text } : {}),
            ...(run.totalTokens !== null ? { totalTokens: run.totalTokens } : {}),
          }));
    if (live.length === 0) return turns;
    return [...turns, ...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [positionNames, selectedId, turnStream.runs, turns]);

  // ADR-0002: Ant Design is the shared design language; token values are antd
  // official palette values, consumed via ConfigProvider — no ad-hoc theming.
  // The provider lives here (not in main.tsx) so tests render the same config;
  // autoInsertSpace is off so two-char CJK labels keep exact accessible names.
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          // #73 Control Plane v2（取代 #31 冻结值）：全应用单一强调色，一次定死
          // （Linear lavender 纪律样本）；AI 紫 #722ed1 仍仅限 AI affordance，
          // 不在此列。状态色/描边改用 control-plane 设计稿的哑光调，与
          // antd-skin.css 的 --ui-* 同步（含暗色阶，见 ANTD_SEED）。
          ...ANTD_SEED[themeMode],
          // 控件尺寸对齐设计稿：.sel 高 32 / 字号 12 / 圆角 8，.btn-sm 高 26。
          // antd 默认 14px + 36px 在这套密度里明显偏大（岗位下拉尤其突兀）。
          fontSize: 12,
          borderRadius: 8,
          // 动效三档 120/160/240ms，全 ease-out，禁 >300ms。
          motionDurationFast: "0.12s",
          motionDurationMid: "0.16s",
          motionDurationSlow: "0.24s",
          motionEaseInOut: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          motionEaseOut: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          controlHeight: 32,
          controlHeightSM: 26,
          controlHeightLG: 36,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
    <div className="owb-app">
      {/* 自定义 40px 标题栏（设计稿 .wintitle）：品牌标 + 窗口点 + 引擎/工作区
          状态 chip。状态灯诚实映射 /health，不假装在线。 */}
      <header
        className="owb-wintitle"
        onDoubleClick={() => void window.owb.windowToggleMaximize?.()}
      >
        <span className="owb-wintitle__mark" aria-hidden="true" />
        <WindowControls />
        <span className="owb-wintitle__name">org-workbench</span>
        <span className="owb-wintitle__spacer" />
        <span className="owb-wintitle__chip">
          <span
            className={engineOk ? "owb-led" : "owb-led owb-led--off"}
            role="img"
            aria-label={engineOk ? "引擎可用" : "引擎离线"}
          />
          engine <b>{engineOk ? "available" : "offline"}</b>
          {workspaceInfo?.open === true && workspaceInfo.business
            ? <> · <span>{workspaceInfo.business}</span></>
            : null}
        </span>
      </header>

    {/* 壳层尺寸（导轨 54 / 侧栏 300 / topbar 48）定在 app.css 的
        `.owb-app .ui-app-shell` 里，不走内联 style——内联优先级最高，会把
        窗口缩放的 @media 断点全部盖掉。 */}
    <AppShell
      moduleRail={
        <ModuleRail
          label="模块"
          brand={<span className="owb-rail-brand">owb</span>}
          footer={<span className="owb-rail-tip" aria-hidden="true">LOCAL CONTROL PLANE</span>}
          items={[
            { id: "org", label: "组织", icon: <Network aria-hidden="true" size={16} />, active: activeModule === "org", onSelect: () => setActiveModule("org") },
            { id: "groups", label: "群聊", icon: <UsersRound aria-hidden="true" size={16} />, active: activeModule === "groups", onSelect: () => setActiveModule("groups") },
            { id: "reports", label: "上报", icon: <FileChartColumn aria-hidden="true" size={16} />, active: activeModule === "reports", onSelect: () => { setActiveModule("reports"); void loadReports(); } },
            { id: "memory", label: "记忆", icon: <History aria-hidden="true" size={16} /> },
            { id: "docs", label: "文档", icon: <FolderTree aria-hidden="true" size={16} />, active: activeModule === "docs", onSelect: () => setActiveModule("docs") },
          ]}
        />
      }
      sidebar={
        <Sidebar
          label="组织目录树"
          header={
            <>
              <div className="owb-side-head">
                <span className="owb-side-head__label">组织目录树</span>
                {workspaceInfo?.open === true ? (
                  <>
                    <AntButton size="small" disabled={orgBusy} onClick={() => void undoLastAdjustment()} title="撤销最近一次拖拽调整（⌘Z）">撤销</AntButton>
                    {/* ＋ 走装饰性图标而不是文案前缀，可及名保持「创建员工」。 */}
                    <AntButton size="small" type="primary" disabled={orgBusy} icon={<Plus aria-hidden="true" size={12} />} onClick={() => setTreeHireParent(selectedId ?? snapshot?.owner ?? null)}>创建员工</AntButton>
                  </>
                ) : null}
              </div>
              {/* 工作区条（设计稿 .workspace-strip）：名称 + open 状态 + 岗位数 */}
              {workspaceInfo?.open === true ? (
                <div className="owb-workspace-strip">
                  <span className="owb-workspace-strip__name">{workspaceInfo.business ?? "工作区"}</span>
                  <span className="owb-workspace-strip__meta">
                    <span className="owb-workspace-strip__open">●</span>
                    open
                    {snapshot ? ` · ${snapshot.positionCount} 岗位` : null}
                  </span>
                </div>
              ) : null}
            </>
          }
          footer={
            workspaceInfo?.open === true ? <BackupTray backups={backups} busy={orgBusy} onRestore={restorePosition} /> : (
              <AntButton type="primary" block onClick={() => void openWorkspace()}>
                打开工作区…
              </AntButton>
            )
          }
        >
          {workspaceInfo?.open === true ? (
            treeLoading ? (
              <TreeSkeleton />
            ) : snapshot ? (
              <div
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
                    event.preventDefault();
                    void undoLastAdjustment();
                  }
                }}
              >
                <OrgTree
                  snapshot={snapshot}
                  versionStamp={snapshot.updatedAt}
                  displayNames={positionNames}
                  avatarColors={positionColors}
                  runningIds={runningPositionIds}
                  budgetRatios={budgetRatios}
                  selectedId={selectedId}
                  onSelect={selectPosition}
                  onMove={(id, reportTo) => void movePosition(id, reportTo)}
                  onDropPosition={(drop) => void reorderPosition(drop)}
                  onHireEntry={(parent) => setTreeHireParent(parent)}
                  onGroupEntry={(positionId) => {
                    setGroupDraftSeed({ members: [positionId], nonce: Date.now() });
                    setActiveModule("groups");
                  }}
                  moveDisabled={orgBusy}
                />
              </div>
            ) : (
              <p className="owb-muted">组织数据不可用</p>
            )
          ) : (
            <p className="owb-muted">尚未打开工作区</p>
          )}
          {workspaceInfo?.open === true ? (
            <HireDrawer
              open={treeHireParent !== undefined}
              positions={positions}
              presetReportTo={treeHireParent ?? null}
              onClose={() => setTreeHireParent(undefined)}
              onHired={(positionId, name) => void hiredPosition(positionId, name)}
            />
          ) : null}
        </Sidebar>
      }
      topbar={
        <Topbar
          breadcrumbs={<Breadcrumbs workspace={workspaceInfo} selected={selectedPosition} />}
          actions={
            <div className="owb-topbar-actions">
              {/* 设计稿 .mini-budget：岗位 id · 110px 轨道 · 百分比。声明期
                  （无真实用量事实）显示「声明期」而不是伪造的 0%。 */}
              {selectedPosition?.budget && selectedId ? (
                <MiniBudget positionId={selectedId} ratio={selectedBudgetRatio} />
              ) : null}
              {/* 设计稿 .src 药丸：状态灯 + 文案，取代 DS 的 SourceStatus 外观，
                  诚实映射 /health.engine.available。 */}
              <span className="owb-src" role="status">
                <span
                  className={engineOk ? "owb-led" : "owb-led owb-led--off"}
                  aria-hidden="true"
                />
                <span className="owb-src__text">{engineOk ? "引擎可用" : "引擎离线"}</span>
              </span>
            </div>
          }
        />
      }
    >
      <div className="owb-main">
        {sseState === "connecting" ? (
          <Alert type="info" showIcon role="status" title="事件流重连中…" />
        ) : null}
        {health && !engineOk ? (
          <Alert type="warning" showIcon role="status" title={health.engine?.nextStep ?? "引擎不可用"} />
        ) : null}
        {turnError ? (
          <Alert type="warning" showIcon role="alert" title={turnError} />
        ) : null}
        {orgFeedback ? (
          <Alert type={orgFeedback.tone === "warn" ? "warning" : "info"} showIcon role={orgFeedback.tone === "warn" ? "alert" : "status"} title={orgFeedback.text} />
        ) : null}
        {reportsError ? <Alert type="warning" showIcon role="alert" title={reportsError} /> : null}
        {activeModule === "reports" ? <ReportsCenter reports={reports} loading={reportsLoading} /> : activeModule === "groups" ? (
          <GroupsPanel
            workspaceOpen={workspaceInfo?.open === true}
            positions={positions}
            positionNames={positionNames}
            positionColors={positionColors}
            draftSeed={groupDraftSeed}
            engine={turnEngine}
            engineAvailability={engineAvailability}
            liveRuns={turnStream.runs}
            onSelectEngine={setTurnEngine}
            onSpawnRuns={spawnGroupRuns}
          />
        ) : activeModule === "docs" ? (
          <DocsModule
            workspaceOpen={workspaceInfo?.open === true}
            positions={positions}
            selectedPositionId={selectedId}
          />
        ) : <div className="owb-org-module">
          {/* P0 组织图：应用态汇报树节点图（纯展示，数据与侧栏树同源）。 */}
          <OrgChart
            snapshot={snapshot}
            loading={treeLoading}
            displayNames={positionNames}
            displayTitles={positionTitles}
            displayModes={positionModes}
            avatarColors={positionColors}
            selectedId={selectedId}
            onSelect={selectPosition}
          />
          <div className="owb-workspace-grid">
          <div className="owb-position-column">
            <PositionCard
              position={card.data}
              loading={card.loading}
              notFound={card.notFound}
              consumption={selectedBudgetRatio}
              running={selectedId !== null && runningPositionIds.has(selectedId)}
              onRefresh={() => void refresh()}
            />
            {selectedPosition && selectedId && selectedId !== snapshot?.owner ? <div className="owb-position-actions"><DismissPositionDialog positionName={selectedPosition.name} positionId={selectedId} descendantCount={selectedNode ? countDescendants(selectedNode) : 0} busy={orgBusy} onDismiss={() => dismissPosition(selectedId)} /></div> : null}
          </div>
          <TurnPanel
            workspaceOpen={workspaceInfo?.open === true}
            positions={positions}
            selectedPositionId={selectedId}
            engine={turnEngine}
            engineAvailability={engineAvailability}
            turns={displayTurns}
            busy={turnBusy}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            sessionBusy={sessionBusy}
            onSelectPosition={selectPosition}
            onSelectEngine={setTurnEngine}
            onCreateTurn={createTurn}
            onCancelTurn={cancelTurn}
            onVerdictTurn={verdictTurn}
            decidedApprovalIds={decidedApprovals}
            sseConnected={sseState === "connected"}
            selectedMode={card.data?.mode ?? null}
            selectedBudgetLabel={perTaskBudgetLabel(card.data)}
            cancelling={turnCancelling}
            onSelectSession={selectSession}
            onCreateSession={createSession}
            onRotateSession={rotateSession}
          />
          </div>
        </div>}
      </div>
    </AppShell>
    </div>
    </ConfigProvider>
  );
}

function containsNode(node: OrgTreeNodeV1, id: string): boolean {
  return node.children.some((child) => child.id === id || containsNode(child, id));
}

function countDescendants(node: OrgTreeNodeV1): number {
  return node.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}

function flattenPositionIds(nodes: OrgTreeNodeV1[]): string[] {
  const ids: string[] = [];
  const visit = (node: OrgTreeNodeV1): void => {
    ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return ids;
}

function replaceTurn(turns: TurnRecord[], next: TurnRecord): TurnRecord[] {
  const index = turns.findIndex((turn) => turn.id === next.id);
  if (index < 0) return [...turns, next];
  return turns.map((turn, current) => current === index ? next : turn);
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const message = (body as { message?: unknown }).message;
    const code = (body as { code?: unknown }).code;
    if (typeof message === "string" && typeof code === "string") return `${code}: ${message}`;
    if (typeof message === "string") return message;
    if (typeof code === "string") return `${fallback}: ${code}`;
  }
  return fallback;
}

function TreeSkeleton() {
  return (
    <div className="owb-tree-skeleton" aria-label="组织树加载中">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} style={{ height: 22, width: `${100 - index * 18}%` }} />
      ))}
    </div>
  );
}

function findNodeById(nodes: OrgTreeNodeV1[], id: string): OrgTreeNodeV1 | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Per-task budget label for the boundary chip (设计稿 `40k/task`). Tokens
 * win over iterations because the engine bills tokens; a declaration with
 * neither cap renders — rather than a fabricated number. */
function perTaskBudgetLabel(position: PositionCardData | null): string | null {
  const perTask = position?.budget?.perTask;
  if (!perTask) return null;
  if (typeof perTask.tokens === "number") {
    const k = perTask.tokens / 1000;
    const compact = k >= 1 ? `${Number.isInteger(k) ? k : k.toFixed(1)}k` : String(perTask.tokens);
    return `${compact}/task`;
  }
  if (typeof perTask.iterations === "number") return `${perTask.iterations} iters/task`;
  return null;
}

/** Real window chrome for the frameless shell (设计稿 .wintitle 左上三点).
 * macOS-style traffic lights: close / minimize / maximize, each an actual
 * button with an accessible name — the previous decorative dots sat under the
 * native frame and did nothing. Guarded with `?.` so the renderer still boots
 * against an older preload bridge (tests stub a partial bridge). */
function WindowControls() {
  return (
    <span className="owb-wintitle__controls">
      <button
        type="button"
        className="owb-wctl owb-wctl--close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => void window.owb.windowClose?.()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
        </svg>
      </button>
      <button
        type="button"
        className="owb-wctl owb-wctl--min"
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void window.owb.windowMinimize?.()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.2 5h5.6" />
        </svg>
      </button>
      {/* 文案保持静态：WSLg 下 isMaximized() 不可信，不向用户谎报当前状态。 */}
      <button
        type="button"
        className="owb-wctl owb-wctl--max"
        aria-label="最大化或还原窗口"
        title="最大化 / 还原"
        onClick={() => void window.owb.windowToggleMaximize?.()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="2.6" y="2.6" width="4.8" height="4.8" rx="1" />
        </svg>
      </button>
    </span>
  );
}

/** Live `data-theme` on <html> (index.html seeds "light"). antd's cssinjs
 * algorithm has to follow the same switch as the --ui-* skin, otherwise the
 * shell goes dark while every antd control stays light (spec §5 双主题验收). */
function useThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const target = document.documentElement;
    const sync = (): void =>
      setMode(target.getAttribute("data-theme") === "dark" ? "dark" : "light");
    const observer = new MutationObserver(sync);
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** antd seed tokens per theme — values mirror antd-skin.css exactly so the
 * cssinjs layer and the CSS custom properties never disagree. */
const ANTD_SEED = {
  light: {
    colorPrimary: "#5E6AD2",
    colorSuccess: "#3F7D4E",
    colorWarning: "#A86A0A",
    colorError: "#C04A3E",
    colorInfo: "#5E6AD2",
    colorLink: "#5E6AD2",
    colorBorder: "#DCD7CA",
    colorBorderSecondary: "#E5E1D6",
  },
  dark: {
    colorPrimary: "#8B93E0",
    colorSuccess: "#84B77C",
    colorWarning: "#D3A24F",
    colorError: "#D98276",
    colorInfo: "#8B93E0",
    colorLink: "#8B93E0",
    colorBorder: "#33372F",
    colorBorderSecondary: "#2C302A",
  },
} as const;

/** Topbar mini budget gauge (设计稿 .mini-budget). Declaration phase keeps
 * the track dim and labels it 声明期 — a position with no turn facts never
 * renders a fabricated percentage. */
function MiniBudget({ positionId, ratio }: { positionId: string; ratio: number | null }) {
  const declared = ratio === null;
  const pct = declared ? 100 : Math.min(Math.max(Math.round(ratio * 100), 0), 100);
  const over = !declared && ratio > 1;
  return (
    <span className="owb-mini-budget">
      <span className="owb-mini-budget__label">{positionId}</span>
      <span
        className="owb-mini-budget__track"
        role="meter"
        aria-label={declared ? `${positionId} 预算声明` : `${positionId} 单任务预算消耗`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={declared ? undefined : Math.round(ratio * 100)}
      >
        <i
          style={{
            width: `${pct}%`,
            opacity: declared ? 0.32 : 1,
            ...(over ? { background: "var(--ui-danger)" } : {}),
          }}
        />
      </span>
      <span className="owb-mini-budget__label">
        {declared ? "声明期" : `${Math.round(ratio * 100)}%`}
      </span>
    </span>
  );
}

function Breadcrumbs({
  workspace,
  selected,
}: {
  workspace: WorkspaceInfoResponse | null;
  selected: { id: string } | null;
}) {
  if (workspace?.open !== true) {
    return <span className="owb-breadcrumb owb-muted">未打开工作区</span>;
  }
  // 设计稿：business / positions / <id>，末段是 primary 药丸。岗位 id（而不是
  // 展示名）与树标签、证据里的标识保持一致。
  const parts: string[] = [workspace.business ?? "工作区"];
  if (selected) parts.push("positions", selected.id);
  // 设计稿的面包屑用独立的 "/" 分隔元素（首段展示字体、末段 primary 药丸）。
  return (
    <span className="owb-breadcrumbs">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? (
            <span className="owb-breadcrumb-sep" aria-hidden="true">
              /
            </span>
          ) : null}
          <span className="owb-breadcrumb">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
