import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PositionCard } from "../src/position-card";
import type { PositionCardData } from "../src/types";

const POSITION: PositionCardData = {
  id: "repo-owner",
  name: "Repo Owner",
  description: "Owns the repository roadmap.",
  reportTo: null,
  mode: "read_only",
  contextScope: "/",
  permissions: { toolAllow: ["Read", "Grep", "Glob"], toolDeny: [] },
  budget: { perTask: { tokens: 40000, iterations: 12 }, perDay: { tokens: 400000, iterations: 96 } },
  metadata: {},
};

describe("PositionCard (D1 spec §3)", () => {
  it("shows empty guidance when no position selected", () => {
    render(<PositionCard position={null} />);
    expect(screen.getByText("从左侧选择岗位查看档案")).toBeInTheDocument();
  });

  it("renders a loading skeleton while fetching", () => {
    render(<PositionCard position={null} loading />);
    expect(document.querySelector(".ui-org-position-card__skeleton-title")).not.toBeNull();
  });

  it("renders the 404 notice after disband with a refresh action", () => {
    const onRefresh = vi.fn();
    render(<PositionCard position={null} notFound onRefresh={onRefresh} />);
    expect(screen.getByText(/岗位已不存在/)).toBeInTheDocument();
    screen.getByRole("button", { name: /刷新组织树/ }).click();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("renders budget declaration, permission badges and context scope", () => {
    render(<PositionCard position={POSITION} />);
    expect(screen.getByRole("heading", { name: /预算声明/ })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "单任务声明" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /权限摘要/ })).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Context Scope/ })).toBeInTheDocument();
  });
});
