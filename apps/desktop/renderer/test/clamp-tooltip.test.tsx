import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportsCenter } from "../src/reports/ReportsCenter";
import { TurnThread } from "../src/turns";
import type { TurnRecord } from "../src/turns";
import type { ReportsResponse } from "@org-workbench/shared";

const LONG = "核对冻结契约 turn.* 词表；".repeat(12);

const longTurn: TurnRecord = {
  id: "turn-long",
  positionId: "client-lead",
  positionName: "客户端负责人",
  engine: "qoder",
  input: LONG,
  status: "completed",
  createdAt: "2026-08-25T03:00:00.000Z",
  output: LONG,
};

const shortTurn: TurnRecord = {
  id: "turn-short",
  positionId: "client-lead",
  positionName: "客户端负责人",
  engine: "qoder",
  input: "检查发布",
  status: "completed",
  createdAt: "2026-08-25T03:01:00.000Z",
  output: "已核对",
};

describe("issue #20 two-line clamp + tooltip", () => {
  it("clamps long turn input and output and keeps the full text in title", () => {
    const { container } = render(<TurnThread turns={[longTurn]} />);
    const input = container.querySelector(".owb-turn__request p");
    const output = container.querySelector(".owb-turn__output");
    expect(input).not.toBeNull();
    expect(input?.className).toContain("owb-clamp-2");
    expect(input?.getAttribute("title")).toBe(LONG);
    expect(output).not.toBeNull();
    expect(output?.className).toContain("owb-clamp-2");
    expect(output?.getAttribute("title")).toBe(LONG);
  });

  it("keeps the clamp class on short text without altering it", () => {
    const { container } = render(<TurnThread turns={[shortTurn]} />);
    const input = container.querySelector(".owb-turn__request p");
    expect(input?.getAttribute("title")).toBe("检查发布");
    expect(input?.textContent).toBe("检查发布");
  });

  it("clamps report card paragraphs and the envelope code with full-text titles", () => {
    const digest = `sha256:${"abcdef0123456789".repeat(4)}`;
    const reports: ReportsResponse = {
      schemaVersion: "reports.v1",
      streams: {
        escalations: [
          {
            schemaVersion: "turn-escalation.v1",
            positionId: "client-lead",
            turnId: "turn-long",
            at: "2026-08-25T03:00:00.000Z",
            status: "failed",
            code: "engine_failed",
            reportingChain: ["qa-reviewer"],
            budgetRelated: true,
          },
        ],
        audits: [],
        evidence: [
          {
            schemaVersion: "turn-evidence.v1",
            positionId: "client-lead",
            turnId: "turn-long",
            conversationId: "conv-1",
            engine: "qoder",
            status: "completed",
            createdAt: "2026-08-25T03:00:00.000Z",
            updatedAt: "2026-08-25T03:00:00.000Z",
            envelopeDigest: digest,
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        ],
      },
      budgets: [
        {
          positionId: "client-lead",
          declared: {
            perTask: { tokens: 20_000, iterations: 8 },
            perDay: { tokens: 200_000, iterations: 64 },
          },
          recorded: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          latestTurn: null,
          state: "within",
        },
      ],
      page: { cursor: null, hasMore: false },
    };
    const { container } = render(<ReportsCenter reports={reports} loading={false} />);
    const escalation = container.querySelector(".owb-report-card.is-escalation p");
    expect(escalation?.className).toContain("owb-clamp-2");
    expect(escalation?.getAttribute("title")).toBe(escalation?.textContent);
    fireEvent.click(screen.getByRole("button", { name: /回合证据/ }));
    const code = container.querySelector(".owb-report-card code");
    expect(code?.className).toContain("owb-clamp-2");
    expect(code?.getAttribute("title")).toBe(digest);
    const evidenceP = container.querySelector(".owb-report-card:not(.is-escalation) p");
    expect(evidenceP?.className).toContain("owb-clamp-2");
    expect(evidenceP?.getAttribute("title")).toBe(evidenceP?.textContent);
  });

  it("renders the pending placeholder with clamp and tooltip while running", () => {
    const running: TurnRecord = { ...shortTurn, id: "turn-run", status: "running", output: undefined };
    const { container } = render(<TurnThread turns={[running]} />);
    const pending = container.querySelector(".owb-turn__pending");
    expect(pending?.className).toContain("owb-clamp-2");
    expect(pending?.getAttribute("title")).toBe(pending?.textContent);
  });

  it("exposes the full error text through title on failed turns", () => {
    const failed: TurnRecord = { ...shortTurn, id: "turn-fail", status: "failed", output: undefined, error: LONG };
    const { container } = render(<TurnThread turns={[failed]} />);
    const error = container.querySelector(".owb-turn__error");
    expect(error?.className).toContain("owb-clamp-2");
    expect(error?.getAttribute("title")).toBe(LONG);
  });

  it("keeps the screen reader copy intact for clamped blocks", () => {
    render(<TurnThread turns={[longTurn]} />);
    expect(screen.getAllByText(LONG)).toHaveLength(2);
  });
});
