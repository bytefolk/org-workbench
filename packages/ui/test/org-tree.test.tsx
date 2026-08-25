import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrgTree } from "../src/org-tree";
import { SNAPSHOT } from "./fixtures";

describe("OrgTree (D1 spec §2, frozen org-tree.v1)", () => {
  it("renders enterprise root + nested positions: root=企业, owner beneath, children by reportTo", () => {
    render(<OrgTree snapshot={SNAPSHOT} />);
    const tree = screen.getByRole("tree");
    expect(tree).toBeInTheDocument();

    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(5); // enterprise + repo-owner + 3 positions

    expect(screen.getByText("oss-maintainer")).toBeInTheDocument();
    const enterprise = screen.getByText("oss-maintainer").closest('[role="treeitem"]');
    expect(enterprise).toHaveAttribute("aria-level", "1");
    expect(enterprise).toHaveAttribute("aria-expanded", "true");

    const owner = screen.getByText("repo-owner").closest('[role="treeitem"]');
    expect(owner).toHaveAttribute("aria-level", "2");
    expect(owner).toHaveAttribute("aria-selected", "false");

    const child = screen.getByText("issue-researcher").closest('[role="treeitem"]');
    expect(child).toHaveAttribute("aria-level", "3");
  });

  it("falls back to the engine tree as top level when business is missing", () => {
    render(<OrgTree snapshot={{ ...SNAPSHOT, business: "" }} />);
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(4);
    expect(screen.queryByText("oss-maintainer")).not.toBeInTheDocument();
    const owner = screen.getByText("repo-owner").closest('[role="treeitem"]');
    expect(owner).toHaveAttribute("aria-level", "1");
  });

  it("selects a position on click and reports it", () => {
    const onSelect = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("issue-researcher"));
    expect(onSelect).toHaveBeenCalledWith("issue-researcher");
  });

  it("toggles expansion with the arrow buttons (enterprise and owner)", () => {
    const onExpand = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onExpand={onExpand} />);
    const toggles = screen.getAllByRole("button", { name: "收起" });
    expect(toggles).toHaveLength(2); // enterprise + repo-owner

    fireEvent.click(toggles[1]!); // collapse repo-owner
    expect(onExpand).toHaveBeenCalledWith("repo-owner", false);
    expect(screen.queryByText("issue-researcher")).not.toBeInTheDocument();
    expect(screen.getByText("repo-owner")).toBeInTheDocument();

    fireEvent.click(toggles[0]!); // collapse enterprise
    expect(onExpand).toHaveBeenCalledWith("__enterprise__", false);
    expect(screen.queryByText("repo-owner")).not.toBeInTheDocument();
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
    expect(screen.queryByText("repo-owner")).not.toBeInTheDocument();
  });

  it("renders human display names and avatar initials from position cards", () => {
    const { container } = render(
      <OrgTree
        snapshot={SNAPSHOT}
        displayNames={{ "issue-researcher": "议题研究员" }}
        avatarColors={{ "issue-researcher": "#c96a12" }}
      />,
    );
    expect(screen.getByText("议题研究员")).toBeInTheDocument();
    expect(screen.getByText("issue-researcher")).toBeInTheDocument();

    const row = screen.getByText("issue-researcher").closest('[role="treeitem"]')!;
    const avatar = row.querySelector(".ui-org-tree__avatar")!;
    expect(avatar.textContent).toBe("议");
    expect((avatar as HTMLElement).style.background).toContain("rgb(201, 106, 18)");

    // Positions without a card name keep the id label and get a hue from the id.
    const ownerRow = screen.getByText("repo-owner").closest('[role="treeitem"]')!;
    const ownerAvatar = ownerRow.querySelector(".ui-org-tree__avatar")!;
    expect(ownerAvatar.textContent).toBe("R");
    // jsdom serializes the deterministic hsl hue as rgb.
    expect((ownerAvatar as HTMLElement).style.background).toBe("rgb(149, 37, 177)");
    expect(container.querySelector('[role="treeitem"] .ui-org-tree__name')).toBeTruthy();
  });

  it("renders the empty state when the tree has no positions", () => {
    render(<OrgTree snapshot={{ ...SNAPSHOT, tree: [], positionCount: 0, depth: 0 }} />);
    expect(screen.getByText("尚无岗位，点击招聘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招聘岗位" })).toBeDisabled();
  });

  it("emits a move proposal when a movable position is dropped on a manager or enterprise root", () => {
    const onMove = vi.fn();
    render(<OrgTree snapshot={SNAPSHOT} onMove={onMove} />);
    const source = screen.getByText("issue-researcher").closest('[role="treeitem"]')!;
    const manager = screen.getByText("release-engineer").closest('[role="treeitem"]')!;
    const enterprise = screen.getByText("oss-maintainer").closest('[role="treeitem"]')!;
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(manager, { dataTransfer });
    fireEvent.drop(manager, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith("issue-researcher", "release-engineer");

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(enterprise, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith("issue-researcher", null);
    expect(screen.getByText("repo-owner").closest('[role="treeitem"]')).toHaveAttribute("draggable", "false");
  });
});
