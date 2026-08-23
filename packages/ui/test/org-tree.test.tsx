import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrgTree } from "../src/org-tree";
import { SNAPSHOT } from "./fixtures";

describe("OrgTree (D1 spec §2)", () => {
  it("renders enterprise root + positions: root=企业, owner beneath it, deeper by reportTo", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    const tree = screen.getByRole("tree");
    expect(tree).toBeInTheDocument();

    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(5); // enterprise + repo-owner + 3 positions

    expect(screen.getByText("oss-maintainer")).toBeInTheDocument();
    const enterprise = screen.getByText("oss-maintainer").closest('[role="treeitem"]');
    expect(enterprise).toHaveAttribute("aria-level", "1");
    expect(enterprise).toHaveAttribute("aria-expanded", "true");

    const owner = screen.getByText("Repo Owner").closest('[role="treeitem"]');
    expect(owner).toHaveAttribute("aria-level", "2");

    const child = screen.getByText("Issue Researcher").closest('[role="treeitem"]');
    expect(child).toHaveAttribute("aria-level", "3");
  });

  it("falls back to reportTo-null positions as top level when business is missing", () => {
    render(<OrgTree snapshot={{ ...SNAPSHOT, business: "" }} />);
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(4);
    expect(screen.queryByText("oss-maintainer")).not.toBeInTheDocument();
    const owner = screen.getByText("Repo Owner").closest('[role="treeitem"]');
    expect(owner).toHaveAttribute("aria-level", "1");
  });

  it("selects a position on click and reports it", () => {
    const onSelect = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Issue Researcher"));
    expect(onSelect).toHaveBeenCalledWith("issue-researcher");
  });

  it("toggles expansion with the arrow buttons (enterprise and owner)", () => {
    const onExpand = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onExpand={onExpand} />);
    const toggles = screen.getAllByRole("button", { name: "收起" });
    expect(toggles).toHaveLength(2); // enterprise + repo-owner

    fireEvent.click(toggles[1]!); // collapse repo-owner
    expect(onExpand).toHaveBeenCalledWith("repo-owner", false);
    expect(screen.queryByText("Issue Researcher")).not.toBeInTheDocument();
    expect(screen.getByText("Repo Owner")).toBeInTheDocument();

    fireEvent.click(toggles[0]!); // collapse enterprise
    expect(onExpand).toHaveBeenCalledWith("__enterprise__", false);
    expect(screen.queryByText("Repo Owner")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation (ModuleRail arrow pattern)", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    const tree = screen.getByRole("tree");
    const items = screen.getAllByRole("treeitem");
    act(() => {
      (items[0] as HTMLElement).focus();
    });
    expect(items[0]).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(tree, { key: "End" });
    expect(document.activeElement).toBe(items[4]);

    fireEvent.keyDown(tree, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    // Enter collapses the focused enterprise root.
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(screen.queryByText("Repo Owner")).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no positions", () => {
    render(<OrgTree snapshot={{ ...SNAPSHOT, positions: [], edges: [] }} />);
    expect(screen.getByText("尚无岗位，点击招聘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招聘岗位" })).toBeDisabled();
  });

  it("all-read-only workspace: suppresses per-row locks, shows the read-only note", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    expect(screen.getByText("本工作区为只读模式")).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-org-tree__status svg")).toHaveLength(0);
  });

  it("mixed workspace: per-row lock on read_only positions, no read-only note", () => {
    const mixed = {
      ...SNAPSHOT,
      positions: SNAPSHOT.positions.map((position, index) =>
        index === 1 ? { ...position, mode: "approval_required" as const } : position,
      ),
    };
    render(<OrgTree snapshot={mixed} />);
    expect(screen.queryByText("本工作区为只读模式")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".ui-org-tree__status svg")).toHaveLength(3);
  });
});
