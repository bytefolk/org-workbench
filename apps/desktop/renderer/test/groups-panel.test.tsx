import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupsPanel } from "../src/groups/GroupsPanel";
import type { OwbBridge } from "../src/owb";
import type { GroupConversation } from "@org-workbench/shared";
import type { TurnEngineAvailability } from "../src/turns/types";

/** #53 S3 collaboration visuals: the avatar stack and member roster consume
 * the existing /groups* bridge surface — no new channel is introduced. */

const group: GroupConversation = {
  schemaVersion: "conversation-group.v1",
  conversationRef: "11111111-2222-4333-8444-555555555555",
  sessionId: "99999999-8888-4777-8666-555555555555",
  members: ["repo-owner", "release-engineer"],
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const positions = [
  { id: "repo-owner", name: "Repo Owner" },
  { id: "release-engineer", name: "Release Engineer" },
  { id: "community-operator", name: "Community Operator" },
];

const positionNames = Object.fromEntries(positions.map((position) => [position.id, position.name]));

const readyAvailability: TurnEngineAvailability = { configured: true, ready: true };

function installBridge(): void {
  const bridge = {
    groups: vi.fn().mockResolvedValue({
      status: 200,
      body: { schemaVersion: "conversation-group-list.v1", groups: [group] },
    }),
    groupTimeline: vi.fn().mockResolvedValue({
      status: 200,
      body: { schemaVersion: "group-timeline.v1", conversationRef: group.conversationRef, items: [] },
    }),
    onEvent: vi.fn().mockReturnValue(() => {}),
  };
  window.owb = bridge as unknown as OwbBridge;
}

function renderPanel(extra: { draftSeed?: { members: string[]; nonce: number } | null } = {}) {
  installBridge();
  return render(
    <GroupsPanel
      workspaceOpen
      positions={positions}
      positionNames={positionNames}
      positionColors={{ "repo-owner": "#5e6ad2" }}
      engine="qoder"
      engineAvailability={{
        qoder: readyAvailability,
        "claude-code": readyAvailability,
        "claude-local": readyAvailability,
      }}
      liveRuns={{}}
      onSelectEngine={() => {}}
      onSpawnRuns={() => {}}
      draftSeed={extra.draftSeed ?? null}
    />,
  );
}

describe("GroupsPanel collaboration visuals (#53)", () => {
  it("renders the member avatar stack in the group header and the member roster sidebar", async () => {
    const { container } = renderPanel();
    await waitFor(() => {
      expect(screen.getByLabelText("群成员 2 人")).toBeInTheDocument();
    });
    const stack = screen.getByLabelText("群成员 2 人");
    expect(stack.querySelectorAll(".owb-groups__avatar")).toHaveLength(2);
    expect(stack.querySelector('[title="Repo Owner"]')).toHaveStyle({ background: "#5e6ad2" });
    const roster = container.querySelector(".owb-groups__roster-items");
    expect(roster).toHaveTextContent("Repo Owner");
    expect(roster).toHaveTextContent("Release Engineer");
    expect(roster).not.toHaveTextContent("Community Operator");
    expect(container.querySelectorAll(".owb-groups__roster-item")).toHaveLength(2);
  });

  it("org-tree draftSeed prefills the create panel with the seeded member", async () => {
    const { container } = renderPanel({ draftSeed: { members: ["repo-owner"], nonce: 1 } });
    await waitFor(() => {
      const details = container.querySelector("details.owb-groups__create");
      expect(details).toHaveAttribute("open");
    });
    const seeded = screen.getByLabelText("Repo Owner") as HTMLInputElement;
    const untouched = screen.getByLabelText("Community Operator") as HTMLInputElement;
    expect(seeded.checked).toBe(true);
    expect(untouched.checked).toBe(false);
    // Explicit-action discipline: a single seeded member still cannot create.
    expect(screen.getByRole("button", { name: "创建群聊" })).toBeDisabled();
  });

  it("ignores a draftSeed whose members are all unknown positions", async () => {
    const { container } = renderPanel({ draftSeed: { members: ["ghost-position"], nonce: 1 } });
    await waitFor(() => {
      expect(screen.getByText(/Repo Owner/)).toBeInTheDocument();
    });
    const details = container.querySelector("details.owb-groups__create");
    expect(details).not.toHaveAttribute("open");
  });
});
