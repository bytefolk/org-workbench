import { Building2, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@fullstack-ai-infra/ui";
import { BudgetBar } from "./budget-bar";
import type { OrgTreeNodeV1, OrgTreeSnapshot } from "./types";

export interface OrgTreeProps {
  snapshot: OrgTreeSnapshot;
  /** Applied-state stamp (updatedAt); change re-triggers the 180ms fade. */
  versionStamp?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onExpand?: (id: string, expanded: boolean) => void;
  className?: string;
  ariaLabel?: string;
}

export interface OrgTreeNodeProps {
  node: OrgTreeNodeV1;
  depth: number;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  tabIndex: number;
  onSelect: () => void;
  onToggle: () => void;
  onFocus: () => void;
}

export function OrgTreeNode({
  node,
  depth,
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
      className={cn("ui-org-tree__row", selected && "is-selected")}
      style={{ paddingLeft: `calc(${depth} * var(--ui-space-4, 16px) + var(--ui-space-2, 8px))` }}
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
        {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
      </span>
      <span className="ui-org-tree__label" title={node.id}>
        {node.id}
      </span>
      <BudgetBar
        className="ui-org-tree__budget"
        format="compact"
        declared={{ taskLimit: node.budget.perTask, dailyLimit: node.budget.perDay }}
      />
    </div>
  );
}

const ENTERPRISE_ID = "__enterprise__";

interface FlatNode {
  id: string;
  kind: "enterprise" | "position";
  node: OrgTreeNodeV1 | null;
  name: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * OrgTree — accessible org directory tree (D1 spec §2, frozen org-tree.v1).
 *
 * Root = the enterprise (snapshot.business, Brand icon); the engine's nested
 * tree[] (reportTo-null owner as first level, children by reporting line)
 * renders beneath it. Labels are position ids — the frozen org-tree.v1 node
 * deliberately carries only id/reportTo/budget/children; display names and
 * modes are served via /positions/:id (position card).
 *
 * Accessibility: role=tree/treeitem, roving tabindex; ArrowUp/Down/Home/End
 * move, ArrowRight/Left expand/collapse or move to child/parent, Enter
 * toggles (ModuleRail arrow pattern). Version-stamp (updatedAt) driven
 * updates with a 180ms fade; the UI never polls.
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
  const enterpriseName = snapshot.business?.trim() ?? "";
  const useEnterpriseRoot = enterpriseName.length > 0 && snapshot.tree.length > 0;
  const topLevel = snapshot.tree;

  const allParentIds = useMemo(() => {
    const ids = new Set<string>();
    if (useEnterpriseRoot && topLevel.length > 0) ids.add(ENTERPRISE_ID);
    const visit = (node: OrgTreeNodeV1): void => {
      if (node.children.length > 0) ids.add(node.id);
      for (const child of node.children) visit(child);
    };
    for (const node of topLevel) visit(node);
    return ids;
  }, [topLevel, useEnterpriseRoot]);

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
    const pushNode = (node: OrgTreeNodeV1, depth: number): void => {
      const hasChildren = node.children.length > 0;
      const isExpanded = hasChildren && expanded.has(node.id);
      result.push({ id: node.id, kind: "position", node, name: node.id, depth, hasChildren, expanded: isExpanded });
      if (isExpanded) {
        for (const child of node.children) pushNode(child, depth + 1);
      }
    };
    if (useEnterpriseRoot) {
      const hasChildren = topLevel.length > 0;
      const isExpanded = hasChildren && expanded.has(ENTERPRISE_ID);
      result.push({ id: ENTERPRISE_ID, kind: "enterprise", node: null, name: enterpriseName, depth: 0, hasChildren, expanded: isExpanded });
      if (isExpanded) {
        for (const node of topLevel) pushNode(node, 1);
      }
    } else {
      for (const node of topLevel) pushNode(node, 0);
    }
    return result;
  }, [topLevel, expanded, useEnterpriseRoot, enterpriseName]);

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
        if (current.kind === "enterprise") {
          moveFocus(focusedIndex + 1);
        } else {
          const childIndex = flatNodes.findIndex((entry) => entry.node?.id === current.node?.children[0]?.id);
          if (childIndex >= 0) moveFocus(childIndex);
        }
      }
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      if (current.hasChildren && current.expanded) {
        toggleNode(current.id);
      } else if (current.kind === "position" && current.node?.reportTo) {
        const parentIndex = flatNodes.findIndex((entry) => entry.id === current.node?.reportTo);
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

  if (snapshot.positionCount === 0 || snapshot.tree.length === 0) {
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
      {flatNodes.map((entry) =>
        entry.kind === "enterprise" ? (
          <div
            key={entry.id}
            role="treeitem"
            data-org-node-id={entry.id}
            aria-level={1}
            aria-expanded={entry.expanded}
            tabIndex={focusedId === entry.id ? 0 : -1}
            className={cn("ui-org-tree__row", "ui-org-tree__row--enterprise")}
            style={{ paddingLeft: "var(--ui-space-2, 8px)" }}
            onClick={() => {
              if (entry.hasChildren) toggleNode(entry.id);
            }}
            onFocus={() => setFocusedId(entry.id)}
          >
            <button
              type="button"
              data-ui-org-toggle
              aria-label={entry.expanded ? "收起" : "展开"}
              className={cn("ui-org-tree__toggle", entry.expanded && "is-expanded")}
              onClick={(event) => {
                event.stopPropagation();
                toggleNode(entry.id);
              }}
            >
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            <span className="ui-org-tree__icon" aria-hidden="true">
              <Building2 size={15} />
            </span>
            <span className="ui-org-tree__label" title={entry.name}>
              {entry.name}
            </span>
          </div>
        ) : (
          <OrgTreeNode
            key={entry.id}
            node={entry.node as OrgTreeNodeV1}
            depth={entry.depth}
            selected={selectedId === entry.id}
            expanded={entry.expanded}
            hasChildren={entry.hasChildren}
            tabIndex={focusedId === entry.id ? 0 : -1}
            onSelect={() => onSelect?.(entry.id)}
            onToggle={() => toggleNode(entry.id)}
            onFocus={() => setFocusedId(entry.id)}
          />
        ),
      )}
    </div>
  );
}
