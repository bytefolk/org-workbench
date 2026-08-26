import { Building2, ChevronRight, Folder, FolderOpen, Plus, UsersRound } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@fullstack-ai-infra/ui";
import { BudgetBar } from "./budget-bar";
import type { OrgTreeNodeV1, OrgTreeSnapshot } from "./types";

/** Same-level insertion produced by an edge drop or ⌘-arrow reorder
 * (#32 §1). `order` is the final ordered child-id list of `parentId` with
 * the dragged id already moved in — it maps 1:1 onto the additive
 * change-manifest.v1 `reorder` op; the caller owns validation/apply. */
export interface OrgDropPosition {
  id: string;
  /** Target parent id; null = enterprise top level. */
  parentId: string | null;
  order: string[];
}

export interface OrgTreeProps {
  snapshot: OrgTreeSnapshot;
  /** Applied-state stamp (updatedAt); change re-triggers the 180ms fade. */
  versionStamp?: string | null;
  /** Display names keyed by position id (served via /positions/:id; the
   * frozen org-tree.v1 node carries ids only). Falls back to the raw id. */
  displayNames?: Record<string, string>;
  /** Avatar background colors keyed by position id (e.g. metadata.color);
   * positions without one get a deterministic hue from their id. */
  avatarColors?: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onExpand?: (id: string, expanded: boolean) => void;
  /** Emits a directory-tree move proposal. The caller owns validation/apply. */
  onMove?: (id: string, reportTo: string | null) => void;
  /** Emits a same-level reorder proposal (insertion-line drop / ⌘↑↓←→). */
  onDropPosition?: (drop: OrgDropPosition) => void;
  /** Hover "+" creation entry (#32 AC-004): recruit under parentId (null = enterprise root). */
  onHireEntry?: (parentId: string | null) => void;
  /** Explicit group-chat entry (#53, DS-34-001 §1.3/§7): start a group draft
   * prefilled with this row's position. An explicit action only — the caller
   * owns member confirmation; the tree never broadcasts. */
  onGroupEntry?: (positionId: string) => void;
  /** Single-step undo request (#32 AC-005), ⌘/Ctrl+Z while the tree has focus. */
  onUndo?: () => void;
  moveDisabled?: boolean;
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
  displayName?: string;
  avatarColor?: string;
  onSelect: () => void;
  onToggle: () => void;
  onFocus: () => void;
  draggable: boolean;
  dropActive: boolean;
  /** Invalid drop target while dragging (self/descendant): greyed, no-drop. */
  dropDenied: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** Hover "+" entry (#32 AC-004): recruit a subordinate of this row's position. */
  onHireEntry?: () => void;
  /** Hover group entry (#53): start a group-chat draft prefilled with this row. */
  onGroupEntry?: () => void;
}

export function OrgTreeNode({
  node,
  depth,
  selected,
  expanded,
  hasChildren,
  tabIndex,
  displayName,
  avatarColor,
  onSelect,
  onToggle,
  onFocus,
  draggable,
  dropActive,
  dropDenied,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onHireEntry,
  onGroupEntry,
}: OrgTreeNodeProps) {
  return (
    <div
      role="treeitem"
      data-org-node-id={node.id}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={tabIndex}
      draggable={draggable}
      className={cn(
        "ui-org-tree__row",
        selected && "is-selected",
        draggable && "is-draggable",
        dropActive && "is-drop-target",
        dropDenied && "is-drop-denied",
      )}
      style={{ paddingLeft: "var(--ui-space-2, 8px)" }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-ui-org-toggle]")) {
          onToggle();
        } else {
          onFocus();
          onSelect();
        }
      }}
      onFocus={onFocus}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
      <span
        className="ui-org-tree__avatar"
        aria-hidden="true"
        style={{ background: avatarColor ?? `hsl(${hueForId(node.id)}, 65%, 42%)` }}
      >
        {(displayName ?? node.id).trim().charAt(0).toUpperCase()}
      </span>
      <span className="ui-org-tree__label" title={node.id}>
        {displayName && displayName !== node.id ? (
          <>
            <span className="ui-org-tree__name">{displayName}</span>
            <span className="ui-org-tree__id">{node.id}</span>
          </>
        ) : (
          node.id
        )}
      </span>
      <BudgetBar
        className="ui-org-tree__budget"
        format="compact"
        declared={{ taskLimit: node.budget.perTask, dailyLimit: node.budget.perDay }}
      />
      {onGroupEntry ? (
        <button
          type="button"
          className="ui-org-tree__group"
          aria-label={`与 ${displayName ?? node.id} 发起群聊`}
          onClick={(event) => {
            event.stopPropagation();
            onGroupEntry();
          }}
        >
          <UsersRound aria-hidden="true" size={12} />
        </button>
      ) : null}
      {onHireEntry ? (
        <button
          type="button"
          className="ui-org-tree__add"
          aria-label={`在 ${displayName ?? node.id} 下招聘下属`}
          onClick={(event) => {
            event.stopPropagation();
            onHireEntry();
          }}
        >
          <Plus aria-hidden="true" size={12} />
        </button>
      ) : null}
    </div>
  );
}

const ENTERPRISE_ID = "__enterprise__";

/** Stable avatar hue for positions without a declared color. Exported so
 * other surfaces (#53 group roster) keep avatar hues consistent. */
export function hueForId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

function findInTree(nodes: OrgTreeNodeV1[], id: string): OrgTreeNodeV1 | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findInTree(node.children, id);
    if (nested) return nested;
  }
  return null;
}

function subtreeContains(node: OrgTreeNodeV1, id: string): boolean {
  for (const child of node.children) {
    if (child.id === id || subtreeContains(child, id)) return true;
  }
  return false;
}

interface TreeLocation {
  parentId: string | null;
  /** Sibling list (including the located node) in display order. */
  siblings: OrgTreeNodeV1[];
  index: number;
}

function locateInTree(nodes: OrgTreeNodeV1[], id: string, parentId: string | null = null): TreeLocation | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.id === id) return { parentId, siblings: nodes, index };
    const nested = locateInTree(node.children, id, node.id);
    if (nested) return nested;
  }
  return null;
}

/** Dropping onto self or any of its own descendants would create a cycle. */
function isInvalidDropTarget(tree: OrgTreeNodeV1[], draggedId: string, targetId: string): boolean {
  if (draggedId === targetId) return true;
  const dragged = findInTree(tree, draggedId);
  return dragged !== null && subtreeContains(dragged, targetId);
}

/** Final ordered child-id list of `parentId` with `sourceId` inserted
 * before/after the anchor; mirrors the change-manifest.v1 reorder op shape. */
function buildInsertion(
  tree: OrgTreeNodeV1[],
  topLevel: OrgTreeNodeV1[],
  anchor: OrgTreeNodeV1,
  zone: "before" | "after",
  sourceId: string,
): OrgDropPosition | null {
  const siblings = anchor.reportTo === null ? topLevel : findInTree(tree, anchor.reportTo)?.children ?? [];
  const ids = siblings.map((node) => node.id).filter((id) => id !== sourceId);
  const anchorIndex = ids.indexOf(anchor.id);
  if (anchorIndex < 0) return null;
  const insertAt = zone === "before" ? anchorIndex : anchorIndex + 1;
  return {
    id: sourceId,
    parentId: anchor.reportTo,
    order: [...ids.slice(0, insertAt), sourceId, ...ids.slice(insertAt)],
  };
}

type DropZone = "before" | "after" | "body";

interface DropHint {
  /** Row the hint anchors to; null = enterprise root row. */
  anchorId: string | null;
  zone: DropZone;
}

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
  displayNames,
  avatarColors,
  selectedId,
  onSelect,
  onExpand,
  onMove,
  onDropPosition,
  onHireEntry,
  onGroupEntry,
  onUndo,
  moveDisabled = false,
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
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | undefined>(undefined);
  /** Row currently refused during dragover (self/descendant cycle). */
  const [deniedId, setDeniedId] = useState<string | null>(null);
  /** Light inline toast for refused releases; auto-hides. */
  const [toast, setToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

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
    const key = event.key;
    // #32 AC-005: ⌘/Ctrl+Z requests single-step undo while the tree has
    // focus — container-level, so it fires even when no row is focused.
    if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "Z")) {
      event.preventDefault();
      onUndo?.();
      return;
    }
    const current = flatNodes[focusedIndex];
    if (!current) return;
    // #32 §1: ⌘↑/⌘↓ same-level reorder, ⌘←/⌘→ level change; coexists with
    // the plain-arrow navigation below (modifier required, no conflict).
    if ((event.metaKey || event.ctrlKey) && key.startsWith("Arrow")) {
      if (current.kind !== "position" || !current.node || moveDisabled) return;
      const id = current.node.id;
      if (id === snapshot.owner) {
        event.preventDefault();
        setToast("企业负责人不能调整汇报关系");
        return;
      }
      const location = locateInTree(snapshot.tree, id);
      if (!location) return;
      event.preventDefault();
      if (key === "ArrowUp" || key === "ArrowDown") {
        if (!onDropPosition) return;
        const targetIndex = key === "ArrowUp" ? location.index - 1 : location.index + 1;
        if (targetIndex < 0 || targetIndex >= location.siblings.length) return;
        const order = location.siblings.map((node) => node.id).filter((candidate) => candidate !== id);
        order.splice(targetIndex, 0, id);
        onDropPosition({ id, parentId: location.parentId, order });
        return;
      }
      if (key === "ArrowLeft") {
        // Outdent: report to the parent's own report line.
        if (!onMove || location.parentId === null) return;
        const parent = findInTree(snapshot.tree, location.parentId);
        if (!parent) return;
        onMove(id, parent.reportTo);
        return;
      }
      if (key === "ArrowRight") {
        // Indent: report to the previous sibling.
        if (!onMove) return;
        const previousSibling = location.siblings[location.index - 1];
        if (!previousSibling) return;
        onMove(id, previousSibling.id);
      }
      return;
    }
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
        <button
          type="button"
          className="ui-org-tree__hire-placeholder"
          disabled={!onHireEntry}
          title={onHireEntry ? undefined : "招聘入口 D2 启用"}
          onClick={() => onHireEntry?.(null)}
        >
          招聘岗位
        </button>
      </div>
    );
  }

  const resetDragState = (): void => {
    setDraggedId(null);
    setDropHint(undefined);
    setDeniedId(null);
  };

  const renderPosition = (node: OrgTreeNodeV1, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const hint = dropHint?.anchorId === node.id ? dropHint : null;
    return (
      <Fragment key={node.id}>
        {hint?.zone === "before" ? <div className="ui-org-tree__drop-line" aria-hidden="true" /> : null}
        <OrgTreeNode
          node={node}
          depth={depth}
          selected={selectedId === node.id}
          expanded={isExpanded}
          hasChildren={hasChildren}
          tabIndex={focusedId === node.id ? 0 : -1}
          displayName={displayNames?.[node.id]}
          avatarColor={avatarColors?.[node.id]}
          onSelect={() => onSelect?.(node.id)}
          onToggle={() => toggleNode(node.id)}
          onFocus={() => setFocusedId(node.id)}
          draggable={!moveDisabled && node.id !== snapshot.owner}
          dropActive={hint?.zone === "body"}
          dropDenied={deniedId === node.id}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-org-workbench-position-id", node.id);
            setDraggedId(node.id);
          }}
          onDragEnd={() => {
            if (deniedId !== null) setToast("不能移动到自身或自己的下属");
            resetDragState();
          }}
          onDragOver={(event) => {
            if (!draggedId || moveDisabled) return;
            if (isInvalidDropTarget(snapshot.tree, draggedId, node.id)) {
              // No preventDefault: the browser refuses the drop, and the
              // source's dragend surfaces the light toast below.
              event.dataTransfer.dropEffect = "none";
              setDeniedId(node.id);
              setDropHint(undefined);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDeniedId(null);
            const rect = event.currentTarget.getBoundingClientRect();
            const y = event.clientY - rect.top;
            // Top/bottom quarter rows = same-level insertion, middle half =
            // reparent (body); a zero-height rect (jsdom) resolves to body.
            const zone: DropZone =
              rect.height > 0 && y < rect.height * 0.25
                ? "before"
                : rect.height > 0 && y > rect.height * 0.75
                  ? "after"
                  : "body";
            setDropHint({ anchorId: node.id, zone });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const source = draggedId || event.dataTransfer.getData("application/x-org-workbench-position-id");
            const zone = hint?.zone ?? "body";
            resetDragState();
            if (!source || isInvalidDropTarget(snapshot.tree, source, node.id)) return;
            if (zone === "before" || zone === "after") {
              const drop = buildInsertion(snapshot.tree, topLevel, node, zone, source);
              if (drop) onDropPosition?.(drop);
              return;
            }
            onMove?.(source, node.id);
          }}
          onHireEntry={onHireEntry && !moveDisabled ? () => onHireEntry(node.id) : undefined}
          onGroupEntry={onGroupEntry ? () => onGroupEntry(node.id) : undefined}
        />
        {hint?.zone === "after" ? <div className="ui-org-tree__drop-line" aria-hidden="true" /> : null}
        {isExpanded && hasChildren ? (
          <div className="ui-org-tree__children" role="group">
            {node.children.map((child) => renderPosition(child, depth + 1))}
          </div>
        ) : null}
      </Fragment>
    );
  };

  const enterpriseExpanded = expanded.has(ENTERPRISE_ID) && topLevel.length > 0;

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      ref={containerRef}
      className={cn("ui-org-tree", refreshed && "is-refreshed", className)}
      onKeyDown={handleKeyDown}
    >
      {useEnterpriseRoot ? (
        <Fragment>
          <div
            role="treeitem"
            data-org-node-id={ENTERPRISE_ID}
            aria-level={1}
            aria-expanded={enterpriseExpanded}
            tabIndex={focusedId === ENTERPRISE_ID ? 0 : -1}
            className={cn(
              "ui-org-tree__row",
              "ui-org-tree__row--enterprise",
              dropHint?.anchorId === null && dropHint.zone === "body" && "is-drop-target",
            )}
            style={{ paddingLeft: "var(--ui-space-2, 8px)" }}
            onClick={() => {
              if (topLevel.length > 0) toggleNode(ENTERPRISE_ID);
            }}
            onFocus={() => setFocusedId(ENTERPRISE_ID)}
            onDragOver={(event) => {
              if (!draggedId || moveDisabled) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDeniedId(null);
              setDropHint({ anchorId: null, zone: "body" });
            }}
            onDragLeave={() => setDropHint(undefined)}
            onDrop={(event) => {
              event.preventDefault();
              const source = draggedId || event.dataTransfer.getData("application/x-org-workbench-position-id");
              resetDragState();
              if (source) onMove?.(source, null);
            }}
          >
            <button
              type="button"
              data-ui-org-toggle
              aria-label={enterpriseExpanded ? "收起" : "展开"}
              className={cn("ui-org-tree__toggle", enterpriseExpanded && "is-expanded")}
              onClick={(event) => {
                event.stopPropagation();
                toggleNode(ENTERPRISE_ID);
              }}
            >
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            <span className="ui-org-tree__icon" aria-hidden="true">
              <Building2 size={15} />
            </span>
            <span className="ui-org-tree__label" title={enterpriseName}>
              {enterpriseName}
            </span>
          </div>
          {enterpriseExpanded ? (
            <div className="ui-org-tree__children" role="group">
              {topLevel.map((node) => renderPosition(node, 1))}
            </div>
          ) : null}
        </Fragment>
      ) : (
        topLevel.map((node) => renderPosition(node, 0))
      )}
      {toast !== null ? (
        <div className="ui-org-tree__toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
