import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrgTree } from "../src/org-tree";
import { SNAPSHOT } from "./fixtures";

describe("OrgTree (D1 spec §2)", () => {
  it("renders an accessible tree: role=tree, root at level 1, expanded by default", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    const tree = screen.getByRole("tree");
    expect(tree).toBeInTheDocument();

    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(4);

    const root = screen.getByText("Repo Owner").closest('[role="treeitem"]');
    expect(root).toHaveAttribute("aria-level", "1");
    expect(root).toHaveAttribute("aria-expanded", "true");
    expect(root).toHaveAttribute("aria-selected", "false");

    const child = screen.getByText("Issue Researcher").closest('[role="treeitem"]');
    expect(child).toHaveAttribute("aria-level", "2");
  });

  it("selects a node on click and reports it", () => {
    const onSelect = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Issue Researcher"));
    expect(onSelect).toHaveBeenCalledWith("issue-researcher");
  });

  it("toggles expansion with the arrow button and Enter", () => {
    const onExpand = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onExpand={onExpand} />);
    const toggle = screen.getByRole("button", { name: "收起" });
    fireEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledWith("repo-owner", false);
    expect(screen.queryByText("Issue Researcher")).not.toBeInTheDocument();
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
    expect(document.activeElement).toBe(items[3]);

    fireEvent.keyDown(tree, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    // Enter collapses the focused root node.
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(screen.queryByText("Issue Researcher")).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no positions", () => {
    render(
      <OrgTree snapshot={{ ...SNAPSHOT, positions: [], edges: [] }} />,
    );
    expect(screen.getByText("尚无岗位，点击招聘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招聘岗位" })).toBeDisabled();
  });

  it("marks read-only positions with a lock status", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    const root = screen.getByText("Repo Owner").closest('[role="treeitem"]');
    expect(root?.querySelector(".ui-org-tree__status svg")).not.toBeNull();
  });
});
