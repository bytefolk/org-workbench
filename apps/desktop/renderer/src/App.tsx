import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  Button,
  ModuleRail,
  Sidebar,
  Skeleton,
  SourceStatus,
  Topbar,
} from "@fullstack-ai-infra/ui";
import { BudgetBar, OrgTree, PositionCard } from "@org-workbench/ui";
import type { PositionCardData } from "@org-workbench/ui";
import type {
  HealthResponse,
  OrgTreeNodeV1,
  OrgTreeSnapshot,
  TurnHistory,
  WorkspaceInfoResponse,
} from "@org-workbench/shared";
import { FolderTree, History, Network, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { TurnPanel, adaptTurnHistory, adaptTurnRecord } from "./turns";
import type {
  CreateTurnRequest,
  PositionMentionOption,
  TurnEngine,
  TurnRecord,
} from "./turns";

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
  const [turnEngine, setTurnEngine] = useState<TurnEngine>("qoder");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [turnBusy, setTurnBusy] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [sseState, setSseState] = useState<"connecting" | "connected">("connecting");

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
        const nameEntries = await Promise.all(positionIds.map(async (id) => {
          const response = await window.owb.position(id);
          const body = response.body as { position?: PositionCardData };
          return [id, response.status === 200 ? body.position?.name ?? id : id] as const;
        }));
        const names = Object.fromEntries(nameEntries);
        positionNamesRef.current = names;
        setPositionNames(names);
      } else {
        setSnapshot(null);
        positionNamesRef.current = {};
        setPositionNames({});
      }
    } else {
      setSnapshot(null);
      positionNamesRef.current = {};
      setPositionNames({});
      setSelectedId(null);
      setCard({ loading: false, data: null, notFound: false });
      setTurns([]);
      setTurnError(null);
    }
    setTreeLoading(false);
  }, []);

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
    try {
      const res = await window.owb.turnHistory(id);
      if (selectedIdRef.current !== id) return false;
      if (res.status !== 200) {
        setTurnError(apiErrorMessage(res.body, "本地历史读取失败"));
        return false;
      }
      const history = res.body as TurnHistory;
      setTurns(adaptTurnHistory(history, positionNamesRef.current[id] ?? id));
      setTurnError(null);
      return true;
    } catch {
      if (selectedIdRef.current === id) setTurnError("本地历史读取失败：控制面不可达");
      return false;
    }
  }, []);

  useEffect(() => {
    if (workspaceInfo?.open !== true || selectedId === null) {
      setCard({ loading: false, data: null, notFound: false });
      setTurns([]);
      setTurnError(null);
      return;
    }
    setTurns([]);
    setTurnError(null);
    void loadPosition(selectedId);
    void loadTurnHistory(selectedId);
  }, [loadPosition, loadTurnHistory, selectedId, workspaceInfo?.open, workspaceInfo?.path]);

  useEffect(() => {
    void refresh();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const offEvent = window.owb.onEvent((event) => {
      const envelope = event as { type?: string };
      if (envelope?.type === "org.updated") {
        void refresh();
        return;
      }
      if (["turn.completed", "turn.failed", "turn.indeterminate"].includes(envelope?.type ?? "")) {
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
    const offSse = window.owb.onSseStatus((state) => setSseState(state));
    void window.owb.sseStatus().then((state) => setSseState(state));
    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      offEvent();
      offSse();
    };
  }, [loadTurnHistory, refresh]);

  const selectPosition = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
  }, []);

  const createTurn = useCallback(async (request: CreateTurnRequest) => {
    setTurnBusy(true);
    setTurnError(null);
    try {
      const res = await window.owb.createTurn({
        positionId: request.positionId,
        engine: request.engine,
        input: request.input,
      });
      if (res.status !== 200) {
        const message = apiErrorMessage(res.body, "回合创建失败");
        setTurnError(message);
        return false;
      }
      if (selectedIdRef.current === request.positionId) {
        const returned = adaptTurnRecord(
          res.body,
          positionNamesRef.current[request.positionId] ?? request.positionId,
        );
        setTurns((current) => replaceTurn(current, returned));
      }
      await loadTurnHistory(request.positionId);
      return true;
    } catch {
      setTurnError("回合创建失败：控制面不可达");
      return false;
    } finally {
      setTurnBusy(false);
    }
  }, [loadTurnHistory]);

  const openWorkspace = useCallback(async () => {
    await window.owb.openWorkspace();
    await refresh();
  }, [refresh]);

  const engineOk = health?.engine?.available === true;
  /** The frozen org-tree.v1 carries ids/budgets only; display names and modes
   * arrive via the selected position card (/positions/:id). */
  const selectedPosition = card.data;
  const positions = useMemo<PositionMentionOption[]>(() => {
    if (!snapshot) return [];
    return flattenPositionIds(snapshot.tree).map((id) => ({ id, name: positionNames[id] ?? id }));
  }, [positionNames, snapshot]);
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
  }), [health]);

  return (
    <AppShell
      style={{ "--ui-sidebar-width": "var(--ui-sidebar-wide)" } as CSSProperties}
      moduleRail={
        <ModuleRail
          label="模块"
          brand={<span className="owb-rail-brand">owb</span>}
          items={[
            { id: "org", label: "组织", icon: <Network aria-hidden="true" size={16} />, active: true },
            { id: "memory", label: "记忆", icon: <History aria-hidden="true" size={16} /> },
            { id: "docs", label: "文档", icon: <FolderTree aria-hidden="true" size={16} /> },
          ]}
        />
      }
      sidebar={
        <Sidebar
          label="组织目录树"
          header={<span className="owb-sidebar-header">组织</span>}
          footer={
            workspaceInfo?.open === true ? undefined : (
              <Button size="sm" onClick={() => void openWorkspace()}>
                打开工作区…
              </Button>
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
                selectedId={selectedId}
                onSelect={selectPosition}
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
          <div className="owb-banner owb-banner--info" role="status">
            事件流重连中…
          </div>
        ) : null}
        {health && !engineOk ? (
          <div className="owb-banner owb-banner--warn" role="status">
            <TriangleAlert aria-hidden="true" size={14} />
            <span>{health.engine?.nextStep ?? "引擎不可用"}</span>
          </div>
        ) : null}
        {turnError ? (
          <div className="owb-banner owb-banner--warn" role="alert">
            <TriangleAlert aria-hidden="true" size={14} />
            <span>{turnError}</span>
          </div>
        ) : null}
        <div className="owb-workspace-grid">
          <PositionCard
            position={card.data}
            loading={card.loading}
            notFound={card.notFound}
            onRefresh={() => void refresh()}
          />
          <TurnPanel
            workspaceOpen={workspaceInfo?.open === true}
            positions={positions}
            selectedPositionId={selectedId}
            engine={turnEngine}
            engineAvailability={engineAvailability}
            turns={turns}
            busy={turnBusy}
            onSelectPosition={selectPosition}
            onSelectEngine={setTurnEngine}
            onCreateTurn={createTurn}
          />
        </div>
      </div>
    </AppShell>
  );
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
