import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button as AntButton, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppShell,
  ModuleRail,
  Sidebar,
  Skeleton,
  SourceStatus,
  Topbar,
} from "@fullstack-ai-infra/ui";
import { BudgetBar, OrgTree, PositionCard } from "@org-workbench/ui";
import type { PositionCardData } from "@org-workbench/ui";
import type {
  AddPositionChange,
  ChangeManifest,
  HealthResponse,
  OrgBackupEntry,
  OrgBackupsResponse,
  OrgTreeNodeV1,
  OrgTreeSnapshot,
  ReportsResponse,
  TurnHistory,
  WorkbenchSession,
  WorkbenchSessionList,
  WorkspaceInfoResponse,
} from "@org-workbench/shared";
import { FileChartColumn, FolderTree, History, Network } from "lucide-react";
import type { CSSProperties } from "react";
import {
  EMPTY_TURN_STREAM,
  TurnPanel,
  adaptTurnHistory,
  adaptTurnRecord,
  applyTurnEvent,
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
import { BackupTray, DismissPositionDialog, HirePositionDialog } from "./org/OrgControls";
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
  const [activeModule, setActiveModule] = useState<"org" | "reports">("org");
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
        const cardEntries = await Promise.all(positionIds.map(async (id) => {
          const response = await window.owb.position(id);
          const body = response.body as { position?: PositionCardData };
          const position = response.status === 200 ? body.position : undefined;
          const color = position?.metadata?.color;
          return [id, { name: position?.name ?? id, ...(typeof color === "string" && color.length > 0 ? { color } : {}) }] as const;
        }));
        const names = Object.fromEntries(cardEntries.map(([id, entry]) => [id, entry.name]));
        positionNamesRef.current = names;
        setPositionNames(names);
        setPositionColors(Object.fromEntries(cardEntries.filter(([, entry]) => "color" in entry).map(([id, entry]) => [id, (entry as { color: string }).color])));
        await Promise.all([loadBackups(), loadReports()]);
      } else {
        setSnapshot(null);
        positionNamesRef.current = {};
        setPositionNames({});
        setPositionColors({});
      }
    } else {
      setSnapshot(null);
      positionNamesRef.current = {};
      setPositionNames({});
      setPositionColors({});
      setSelectedId(null);
      setCard({ loading: false, data: null, notFound: false });
      setTurns([]);
      setTurnStream(EMPTY_TURN_STREAM);
      setSessions([]);
      setSelectedSessionId(null);
      selectedSessionIdRef.current = null;
      setTurnError(null);
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

  const hirePosition = useCallback(async (position: AddPositionChange["position"]) =>
    applyOrg({ schemaVersion: "change-manifest.v1", changes: [{ op: "add", position }] }, `已招聘 ${position.name}`), [applyOrg]);

  const dismissPosition = useCallback(async (id: string) =>
    applyOrg({ schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id }] }, `已裁撤 ${id}；目录保留在恢复区`), [applyOrg]);

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
          .filter(([runId, run]) => run.positionId === selectedId && !historyRunIds.has(runId))
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
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677FF",
          colorSuccess: "#52C41A",
          colorWarning: "#FAAD14",
          colorError: "#FF4D4F",
          colorInfo: "#1677FF",
          borderRadius: 6,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
    <AppShell
      style={{ "--ui-sidebar-width": "18rem" } as CSSProperties}
      moduleRail={
        <ModuleRail
          label="模块"
          brand={<span className="owb-rail-brand">owb</span>}
          items={[
            { id: "org", label: "组织", icon: <Network aria-hidden="true" size={16} />, active: activeModule === "org", onSelect: () => setActiveModule("org") },
            { id: "reports", label: "上报", icon: <FileChartColumn aria-hidden="true" size={16} />, active: activeModule === "reports", onSelect: () => { setActiveModule("reports"); void loadReports(); } },
            { id: "memory", label: "记忆", icon: <History aria-hidden="true" size={16} /> },
            { id: "docs", label: "文档", icon: <FolderTree aria-hidden="true" size={16} /> },
          ]}
        />
      }
      sidebar={
        <Sidebar
          label="组织目录树"
          header={<div className="owb-sidebar-title"><span className="owb-sidebar-header">组织</span>{workspaceInfo?.open === true ? <HirePositionDialog positions={positions} defaultManager={selectedId ?? snapshot?.owner ?? null} busy={orgBusy} onHire={hirePosition} /> : null}</div>}
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
              <OrgTree
                snapshot={snapshot}
                versionStamp={snapshot.updatedAt}
                displayNames={positionNames}
                avatarColors={positionColors}
                selectedId={selectedId}
                onSelect={selectPosition}
                onMove={(id, reportTo) => void movePosition(id, reportTo)}
                moveDisabled={orgBusy}
              />
            ) : (
              <p className="owb-muted">组织数据不可用</p>
            )
          ) : (
            <p className="owb-muted">尚未打开工作区</p>
          )}
        </Sidebar>
      }
      topbar={
        <Topbar
          breadcrumbs={<Breadcrumbs workspace={workspaceInfo} selected={selectedPosition} snapshot={snapshot} />}
          actions={
            <div className="owb-topbar-actions">
              {selectedPosition?.budget ? (
                <BudgetBar
                  format="compact"
                  declared={{
                    taskLimit: selectedPosition.budget.perTask,
                    dailyLimit: selectedPosition.budget.perDay,
                  }}
                  label={selectedPosition.name}
                  consumption={selectedBudgetRatio}
                />
              ) : null}
              <SourceStatus
                state={engineOk ? "available" : "offline"}
                label={engineOk ? "引擎可用" : "引擎离线"}
              />
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
        {activeModule === "reports" ? <ReportsCenter reports={reports} loading={reportsLoading} /> : <div className="owb-workspace-grid">
          <div className="owb-position-column">
            <PositionCard
              position={card.data}
              loading={card.loading}
              notFound={card.notFound}
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
            cancelling={turnCancelling}
            onSelectSession={selectSession}
            onCreateSession={createSession}
            onRotateSession={rotateSession}
          />
        </div>}
      </div>
    </AppShell>
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

function Breadcrumbs({
  workspace,
  selected,
  snapshot,
}: {
  workspace: WorkspaceInfoResponse | null;
  selected: { name: string; reportTo: string | null } | null;
  snapshot: OrgTreeSnapshot | null;
}) {
  if (workspace?.open !== true) {
    return <span className="owb-breadcrumb owb-muted">未打开工作区</span>;
  }
  const parts: string[] = [workspace.business ?? "工作区"];
  if (selected) {
    const chain: string[] = [selected.name];
    const guard = new Set<string>();
    let cursor: string | null = selected.reportTo;
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const parent = snapshot ? findNodeById(snapshot.tree, cursor) : null;
      if (!parent) break;
      chain.unshift(parent.id);
      cursor = parent.reportTo;
    }
    parts.push(...chain);
  }
  return (
    <span className="owb-breadcrumbs">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="owb-breadcrumb">
          {part}
        </span>
      ))}
    </span>
  );
}
