import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupsPanel } from "../src/groups/GroupsPanel";
import { TurnThread } from "../src/turns";
import type { OwbBridge } from "../src/owb";
import type { GroupConversation, TurnRecord as ApiTurnRecord } from "@org-workbench/shared";
import type { TurnEngineAvailability, TurnRecord } from "../src/turns/types";

/** #61 bubble chat structure: operator right bubble / employee left bubble
 * (avatar + name + engine label) / typing / embedded approval / collapsible
 * evidence (audit red line) / group member identity. Contract layer untouched. */

function turn(overrides: Partial<TurnRecord>): TurnRecord {
  return {
    id: "turn-1",
    positionId: "release-engineer",
    positionName: "发布负责人",
    engine: "qoder",
    input: "检查发布门禁",
    status: "completed",
    createdAt: "2026-08-26T04:00:00.000Z",
    output: "门禁已检查。",
    ...overrides,
  };
}

describe("TurnThread bubble structure (#61)", () => {
  it("renders the operator message as a right bubble and the employee reply as a left bubble with avatar + name + engine label", () => {
    const { container } = render(<TurnThread turns={[turn({})]} />);
    const operator = container.querySelector(".owb-bubble-row--operator .owb-bubble--operator");
    const employeeRow = container.querySelector(".owb-bubble-row--employee");
    const employee = employeeRow?.querySelector(".owb-bubble--employee");
    expect(operator).not.toBeNull();
    expect(employee).not.toBeNull();
    expect(operator?.textContent).toContain("检查发布门禁");
    // avatar sits beside the employee bubble inside the row
    expect(employeeRow?.querySelector(".owb-bubble__avatar")).not.toBeNull();
    expect(employee?.querySelector(".owb-bubble__name")?.textContent).toBe("发布负责人");
    expect(employee?.textContent).toContain("Qoder");
  });

  it("shows the typing indicator while the employee turn is running", () => {
    render(<TurnThread turns={[turn({ id: "run-1", status: "running", output: undefined })]} />);
    const typing = screen.getByRole("status");
    expect(typing.className).toContain("owb-bubble__typing");
    expect(typing.textContent).toContain("正在等待岗位完成本回合");
  });

  it("keeps evidence auditable inside a collapsed-by-default block", () => {
    const { container } = render(
      <TurnThread turns={[turn({ id: "ev-1", envelopeDigest: "sha256:env", evidenceDigest: "sha256:evi" })]} />,
    );
    const details = container.querySelector("details.owb-bubble__evidence") as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    // Digests stay in the DOM (auditability red line — collapsible, never dropped).
    expect(container.querySelector('[title="sha256:env"]')).not.toBeNull();
    expect(container.querySelector('[title="sha256:evi"]')).not.toBeNull();
    expect(screen.getByText("回合证据")).toBeInTheDocument();
  });

  it("embeds the approval card inside the employee bubble", () => {
    render(
      <TurnThread
        turns={[
          turn({
            id: "appr-1",
            status: "failed",
            output: undefined,
            error: "engine.approval_required: awaiting operator verdict",
            approvalRequest: { approvalId: "appr-9", kind: "exec", description: "rm -rf dist" },
          }),
        ]}
        onVerdict={() => {}}
      />,
    );
    const card = screen.getByRole("group", { name: "审批请求" });
    expect(card.closest(".owb-bubble--employee")).not.toBeNull();
    expect(screen.getByRole("button", { name: "批准并继续" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
  });
});

describe("group chat bubbles with member identity (#61)", () => {
  const group: GroupConversation = {
    schemaVersion: "conversation-group.v1",
    conversationRef: "11111111-2222-4333-8444-555555555555",
    sessionId: "99999999-8888-4777-8666-555555555555",
    members: ["repo-owner", "release-engineer"],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };

  it("renders member bubbles carrying avatar + @name identity and right-aligned operator bubbles", async () => {
    const memberTurn: ApiTurnRecord = {
      schemaVersion: "turn-record.v1",
      conversationId: "conv-1",
      turnId: "turn-g1",
      positionId: "release-engineer",
      engine: "qoder",
      status: "completed",
      input: "发布检查",
      envelopeDigest: "sha256:0",
      createdAt: "2026-08-26T04:10:00.000Z",
      updatedAt: "2026-08-26T04:11:00.000Z",
      events: [],
      output: "发布已检查。",
    };
    const bridge = {
      groups: vi.fn().mockResolvedValue({
        status: 200,
        body: { schemaVersion: "conversation-group-list.v1", groups: [group] },
      }),
      groupTimeline: vi.fn().mockResolvedValue({
        status: 200,
        body: {
          schemaVersion: "group-timeline.v1",
          conversationRef: group.conversationRef,
          items: [
            {
              kind: "user",
              schemaVersion: "group-message.v1",
              messageId: "m1",
              conversationRef: group.conversationRef,
              input: "各位同步进度",
              mentions: ["release-engineer"],
              createdAt: "2026-08-26T04:09:00.000Z",
            },
            { kind: "member", turn: memberTurn },
          ],
        },
      }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    };
    window.owb = bridge as unknown as OwbBridge;

    const availability: TurnEngineAvailability = { configured: true, ready: true };
    const { container } = render(
      <GroupsPanel
        workspaceOpen
        positions={[
          { id: "repo-owner", name: "Repo Owner" },
          { id: "release-engineer", name: "Release Engineer" },
        ]}
        positionNames={{ "repo-owner": "Repo Owner", "release-engineer": "Release Engineer" }}
        positionColors={{ "release-engineer": "#5e6ad2" }}
        engine="qoder"
        engineAvailability={{
          qoder: availability,
          "claude-code": availability,
          "claude-local": availability,
        }}
        liveRuns={{}}
        onSelectEngine={() => {}}
        onSpawnRuns={() => {}}
        draftSeed={null}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".owb-bubble-row--employee .owb-bubble__avatar")).not.toBeNull();
    });
    const memberRow = container.querySelector(".owb-bubble-row--employee");
    expect(memberRow?.querySelector(".owb-bubble__avatar")).toHaveStyle({ background: "#5e6ad2" });
    expect(memberRow?.querySelector(".owb-bubble__name")?.textContent).toBe("@Release Engineer");
    expect(memberRow?.textContent).toContain("发布已检查。");
    const operatorRow = container.querySelector(".owb-bubble-row--operator .owb-bubble--operator");
    expect(operatorRow?.textContent).toContain("各位同步进度");
  });
});
