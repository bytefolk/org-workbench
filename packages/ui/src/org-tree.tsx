import { Building2, ChevronRight, Folder, FolderOpen, Lock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@fullstack-ai-infra/ui";
import { BudgetBar } from "./budget-bar";
import type { OrgRole, OrgTreeSnapshot, TreeNodeState } from "./types";

export interface OrgTreeProps {
  snapshot: OrgTreeSnapshot;
  /** Monotonic control-plane version stamp; change re-triggers the 180ms fade. */
  versionStamp?: number | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onExpand?: (id: string, expanded: boolean) => void;
  className?: string;
  ariaLabel?: string;
}

export interface OrgTreeNodeProps {
  node: OrgRole;
  depth: number;
  state: TreeNodeState;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  tabIndex: number;
  onSelect: () => void;
  onToggle: () => void;
  onFocus: () => void;
}

/** D1 state derivation: consumption-driven states (warning/over/ai) land with
 * D3/D4; readonly = mode read_only (pending Design Lead confirmation). */
export function treeNodeState(node: OrgRole): TreeNodeState {
  if (node.mode === "read_only") return "readonly";
  return "ok";
}

export function OrgTreeNode({
  node,
  depth,
  state,
  selected,
  expanded,
  hasChildren,
  tabIndex,
  onSelect,
  onToggle,
  onFocus,
}: OrgTreeNodeProps) {
  return (
    <div
      role="treeitem"
      data-org-node-id={node.id}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={tabIndex}
      className={cn(
        "ui-org-tree__row",
        selected && "is-selected",
        state === "warning" && "is-warning",
        state === "over" && "is-over",
        state === "readonly" && "is-readonly",
      )}
      style={{ paddingLeft: `calc(${depth} * var(--ui-space-4, 16px) + 8px)` }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-ui-org-toggle]")) {
          onToggle();
        } else {
          onFocus();
          onSelect();
        }
      }}
      onFocus={onFocus}
    >
      {hasChildren ? (
        <button
          type="button"
          data-ui-org-toggle
          aria-label={expanded ? "收起" : "展开"}
          className={cn("ui-org-tree__toggle", expanded && "is-expanded")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      ) : (
        <span className="ui-org-tree__spacer" aria-hidden="true" />
      )}
      <span className="ui-org-tree__icon" aria-hidden="true">
        {depth === 0 ? (
          <Building2 size={15} />
        ) : expanded ? (
          <FolderOpen size={15} />
        ) : (
          <Folder size={15} />
        )}
      </span>
      <span className="ui-org-tree__label" title={node.name}>
        {node.name}
      </span>
      {node.budget ? (
        <BudgetBar
          className="ui-org-tree__budget"
          format="compact"
          declared={{ taskLimit: node.budget.perTask, dailyLimit: node.budget.perDay }}
        />
      ) : null}
      <span className="ui-org-tree__status" aria-hidden="true">
        {state === "readonly" ? <Lock size={13} /> : null}
        {state === "warning" ? <TriangleAlert size={13} /> : null}
        {state === "over" ? <TriangleAlert size={13} className="is-over" /> : null}
      </span>
    </div>
  );
}

interface FlatNode {
  id: string;
  role: OrgRole;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * OrgTree — accessible read-only org directory tree (D1 spec §2).
 * role=tree/treeitem, roving tabindex; keyboard: ArrowUp/Down/Home/End move,
 * ArrowRight/Left expand/collapse or parent, Enter toggles. The arrow pattern
 * follows the design-system ModuleRail convention. Version-stamp driven
 * updates with a 180ms fade; UI never polls (SSE only).
 */
export function OrgTree({
  snapshot,
  versionStamp,
  selectedId,
  onSelect,
  onExpand,
  className,
  ariaLabel = "组织目录树",
}: OrgTreeProps) {
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, OrgRole[]>();
    for (const position of snapshot.positions) {
      const key = position.reportTo ?? null;
      const bucket = map.get(key);
      if (bucket) bucket.push(position);
      else map.set(key, [position]);
    }
    return map;
  }, [snapshot.positions]);

  const roots = childrenOf.get(null) ?? [];
  const allParentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const position of snapshot.positions) {
      if ((childrenOf.get(position.id) ?? []).length > 0) ids.add(position.id);
    }
    return ids;
  }, [snapshot.positions, childrenOf]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allParentIds));
  const [focusedId, setFocusedId] = useState<string | null>(selectedId ?? null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of allParentIds) next.add(id);
      return next;
    });
  }, [allParentIds]);

  const flatNodes = useMemo<FlatNode[]>(() => {
    const result: FlatNode[] = [];
    const visit = (parentId: string | null, depth: number): void => {
      for (const role of childrenOf.get(parentId) ?? []) {
        const hasChildren = (childrenOf.get(role.id) ?? []).length > 0;
        const isExpanded = hasChildren && expanded.has(role.id);
        result.push({ id: role.id, role, depth, hasChildren, expanded: isExpanded });
        if (isExpanded) visit(role.id, depth + 1);
      }
    };
    visit(null, 0);
    return result;
  }, [childrenOf, expanded]);

  const focusedIndex = flatNodes.findIndex((entry) => entry.id === focusedId);

  const focusNode = useCallback((id: string) => {
    setFocusedId(id);
    const element = containerRef.current?.querySelector(`[data-org-node-id="${id}"]`);
    if (element instanceof HTMLElement) element.focus();
  }, []);

  const moveFocus = useCallback(
    (nextIndex: number) => {
      const wrapped = (nextIndex + flatNodes.length) % flatNodes.length;
      const node = flatNodes[wrapped];
      if (node) focusNode(node.id);
    },
    [flatNodes, focusNode],
  );

  const toggleNode = useCallback(
    (id: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        const isExpanded = next.has(id);
        if (isExpanded) next.delete(id);
        else next.add(id);
        onExpand?.(id, !isExpanded);
        return next;
      });
    },
    [onExpand],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = flatNodes[focusedIndex];
    if (!current) return;
    const key = event.key;
    if (key === "ArrowDown") {
      event.preventDefault();
      moveFocus(focusedIndex + 1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      moveFocus(focusedIndex - 1);
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      moveFocus(0);
      return;
    }
    if (key === "End") {
      event.preventDefault();
      moveFocus(flatNodes.length - 1);
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      if (current.hasChildren && !current.expanded) {
        toggleNode(current.id);
      } else if (current.hasChildren) {
        const childIndex = flatNodes.findIndex((entry) => entry.role.reportTo === current.id);
        if (childIndex >= 0) moveFocus(childIndex);
      }
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      if (current.hasChildren && current.expanded) {
        toggleNode(current.id);
      } else if (current.role.reportTo) {
        const parentIndex = flatNodes.findIndex((entry) => entry.id === current.role.reportTo);
        if (parentIndex >= 0) moveFocus(parentIndex);
      }
      return;
    }
    if (key === "Enter" && current.hasChildren) {
      event.preventDefault();
      toggleNode(current.id);
    }
  };

  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    if (versionStamp === null || versionStamp === undefined) return;
    setRefreshed(true);
    const timer = setTimeout(() => setRefreshed(false), 180);
    return () => clearTimeout(timer);
  }, [versionStamp]);

  if (snapshot.positions.length === 0) {
    return (
      <div className={cn("ui-org-tree", "ui-org-tree--empty", className)}>
        <p>尚无岗位，点击招聘</p>
        <button type="button" className="ui-org-tree__hire-placeholder" disabled title="招聘入口 D2 启用">
          招聘岗位
        </button>
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      ref={containerRef}
      className={cn("ui-org-tree", refreshed && "is-refreshed", className)}
      onKeyDown={handleKeyDown}
    >
      {flatNodes.map((entry) => (
        <OrgTreeNode
          key={entry.id}
          node={entry.role}
          depth={entry.depth}
          state={treeNodeState(entry.role)}
          selected={selectedId === entry.id}
          expanded={entry.expanded}
          hasChildren={entry.hasChildren}
          tabIndex={focusedId === entry.id ? 0 : -1}
          onSelect={() => onSelect?.(entry.id)}
          onToggle={() => toggleNode(entry.id)}
          onFocus={() => setFocusedId(entry.id)}
        />
      ))}
    </div>
  );
}
