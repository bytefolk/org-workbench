import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Badge,
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
  OrgTreeSnapshot,
  WorkspaceInfoResponse,
} from "@org-workbench/shared";
import { FolderTree, History, Network, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";

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
  const [card, setCard] = useState<PositionCardState>({
    loading: false,
    data: null,
    notFound: false,
  });
  const [sseState, setSseState] = useState<"connecting" | "connected">("connecting");

  const refresh = useCallback(async () => {
    const [statusRes, workspaceRes] = await Promise.all([
      window.owb.status(),
      window.owb.workspace(),
    ]);
    setHealth(statusRes.body as HealthResponse | null);
    const ws = workspaceRes.body as WorkspaceInfoResponse | null;
    setWorkspaceInfo(ws);
    if (ws?.open === true) {
      const treeRes = await window.owb.orgTree();
      if (treeRes.status === 200) setSnapshot(treeRes.body as OrgTreeSnapshot);
    } else {
      setSnapshot(null);
      setSelectedId(null);
      setCard({ loading: false, data: null, notFound: false });
    }
    setTreeLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const offEvent = window.owb.onEvent((event) => {
      const envelope = event as { type?: string };
      if (envelope?.type === "org.updated") void refresh();
    });
    const offSse = window.owb.onSseStatus((state) => setSseState(state));
    return () => {
      offEvent();
      offSse();
    };
  }, [refresh]);

  const selectPosition = useCallback(async (id: string) => {
    setSelectedId(id);
    setCard({ loading: true, data: null, notFound: false });
    const res = await window.owb.position(id);
    const body = res.body as { position?: PositionCardData; code?: string };
    if (res.status === 404 || body?.code === "position_missing") {
      setCard({ loading: false, data: null, notFound: true });
      return;
    }
    setCard({ loading: false, data: body?.position ?? null, notFound: false });
  }, []);

  const openWorkspace = useCallback(async () => {
    await window.owb.openWorkspace();
    await refresh();
  }, [refresh]);

  const engineOk = health?.engine?.available === true;
  const missingBudgetCount =
    snapshot?.positions.filter((position) => !position.budget).length ?? 0;
  const selectedPosition =
    snapshot?.positions.find((position) => position.id === selectedId) ?? null;

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
                versionStamp={snapshot.version.seq}
                selectedId={selectedId}
                onSelect={(id) => void selectPosition(id)}
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
              {missingBudgetCount > 0 ? (
                <Badge tone="warning">{missingBudgetCount} 个岗位预算未配齐</Badge>
              ) : null}
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
        <PositionCard
          position={card.data}
          loading={card.loading}
          notFound={card.notFound}
          onRefresh={() => void refresh()}
        />
      </div>
    </AppShell>
  );
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
      const parent = snapshot?.positions.find((position) => position.id === cursor);
      if (!parent) break;
      chain.unshift(parent.name);
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
