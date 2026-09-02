import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrgChart, orgChartBudgetLabel } from "../src/org/OrgChart";
import type { OrgTreeSnapshot } from "@org-workbench/shared";

const snapshot: OrgTreeSnapshot = {
  schemaVersion: "org-tree.v1",
  business: "开源业务",
  owner: "repo-owner",
  updatedAt: "2026-08-24T04:00:00.000Z",
  positionCount: 3,
  depth: 2,
  tree: [{
    id: "repo-owner",
    reportTo: null,
    budget: { perTask: { tokens: 40000 }, perDay: { tokens: 800000 } },
    children: [
      { id: "docs-writer", reportTo: "repo-owner", budget: { perTask: { iterations: 10 }, perDay: {} }, children: [] },
      { id: "release-engineer", reportTo: "repo-owner", budget: { perTask: {}, perDay: {} }, children: [] },
    ],
  }],
};

describe("P0 组织图可视化（纯展示：节点 + 汇报线 + 空态/加载态）", () => {
  it("加载态渲染骨架屏而不是节点", () => {
    render(<OrgChart snapshot={snapshot} loading />);
    expect(screen.getByLabelText("组织图加载中")).toBeInTheDocument();
    expect(screen.queryByText("代码库负责人")).not.toBeInTheDocument();
  });

  it("快照缺失或空树渲染空态", () => {
    const { unmount } = render(<OrgChart snapshot={null} />);
    expect(screen.getByText("暂无组织数据")).toBeInTheDocument();
    unmount();
    render(<OrgChart snapshot={{ ...snapshot, tree: [] }} />);
    expect(screen.getByText("暂无组织数据")).toBeInTheDocument();
  });

  it("渲染汇报树：角色名 / title / 预算徽标 / mode 与层级分支", () => {
    const { container } = render(
      <OrgChart
        snapshot={snapshot}
        displayNames={{ "repo-owner": "代码库负责人", "docs-writer": "文档负责人", "release-engineer": "发布工程师" }}
        displayTitles={{ "docs-writer": "公开文档与发布说明" }}
        displayModes={{ "repo-owner": "approval_required", "docs-writer": "read_only" }}
      />,
    );
    // 头部位面：岗位数与深度来自应用态快照。
    expect(screen.getByText("3 岗位 · 深度 2")).toBeInTheDocument();
    // 角色名（展示面注入）与 title 副行；缺 title 回退岗位 id。
    expect(screen.getByText("代码库负责人")).toBeInTheDocument();
    expect(screen.getByText("公开文档与发布说明")).toBeInTheDocument();
    expect(screen.getAllByText("release-engineer").length).toBeGreaterThan(0);
    // 预算徽标：40000 tokens → 40k/task；iterations 面 → iter/task；双无声明不渲染。
    expect(screen.getByText("40k/task")).toBeInTheDocument();
    expect(screen.getByText("10 iter/task")).toBeInTheDocument();
    // mode 徽标：只读 / 需审批；未注入 mode 的节点不渲染徽标。
    expect(screen.getByText("需审批")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    // 汇报线走线：3 个节点 → 3 个分支容器（伪元素连接线挂在其上）。
    expect(container.querySelectorAll(".owb-org-chart__branch")).toHaveLength(3);
    expect(container.querySelector(".owb-org-chart__children")).not.toBeNull();
  });

  it("点击节点触发 onSelect；选中节点带高亮态与按压语义", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <OrgChart snapshot={snapshot} selectedId="repo-owner" onSelect={onSelect} />,
    );
    const owner = container.querySelector('[data-org-chart-node="repo-owner"]')!;
    const docs = container.querySelector('[data-org-chart-node="docs-writer"]')!;
    expect(owner).toHaveClass("is-selected");
    expect(owner).toHaveAttribute("aria-pressed", "true");
    expect(docs).not.toHaveClass("is-selected");
    fireEvent.click(docs);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("docs-writer");
  });

  it("展示面缺条目时回退岗位 id，不编造语义", () => {
    const { container } = render(<OrgChart snapshot={snapshot} />);
    // 无 displayNames：节点主行显示岗位 id。
    expect(screen.getAllByText("repo-owner").length).toBeGreaterThan(0);
    // 无 displayModes：不出现 mode 徽标。
    expect(screen.queryByText("只读")).not.toBeInTheDocument();
    expect(screen.queryByText("需审批")).not.toBeInTheDocument();
    // release-engineer 双无预算声明：无预算徽标元素（3 节点只有 2 个徽标）。
    expect(container.querySelectorAll(".owb-org-chart__budget")).toHaveLength(2);
  });
});

describe("orgChartBudgetLabel（预算徽标口径：与 perTaskBudgetLabel 同源）", () => {
  it("token 优先：>=1k 走 k 记法", () => {
    expect(orgChartBudgetLabel({ perTask: { tokens: 40000 }, perDay: {} })).toBe("40k/task");
    expect(orgChartBudgetLabel({ perTask: { tokens: 1500 }, perDay: {} })).toBe("1.5k/task");
    expect(orgChartBudgetLabel({ perTask: { tokens: 900 }, perDay: {} })).toBe("900/task");
  });

  it("无 token 声明时用 iterations 面", () => {
    expect(orgChartBudgetLabel({ perTask: { iterations: 10 }, perDay: {} })).toBe("10 iter/task");
  });

  it("双无声明返回 null（不渲染，而不是伪造数字）", () => {
    expect(orgChartBudgetLabel({ perTask: {}, perDay: {} })).toBeNull();
    expect(orgChartBudgetLabel(null)).toBeNull();
  });
  it("画布平移：光标按住拖拽即平移组织图，松手退出 pan 态 (#137 review)", () => {
    const { container } = render(<OrgChart snapshot={snapshot} />);
    const body = container.querySelector("#owb-org-chart-body") as HTMLElement;
    expect(body).not.toBeNull();
    // jsdom 没有布局盒，scrollLeft 恒为 0；用数据属性覆写让平移可观测。
    Object.defineProperty(body, "scrollLeft", { writable: true, value: 0 });
    Object.defineProperty(body, "scrollTop", { writable: true, value: 0 });

    fireEvent.pointerDown(body, { button: 0, pointerId: 7, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(body, { pointerId: 7, clientX: 80, clientY: 80 });
    expect(body.scrollLeft).toBe(40);
    expect(body.className).toContain("is-panning");
    fireEvent.pointerUp(body, { pointerId: 7 });
    expect(body.className).not.toContain("is-panning");
  });

  it("点击阈值：小于 4px 的移动不进入 pan，节点点击不受拖拽影响 (#137 review)", () => {
    const { container } = render(<OrgChart snapshot={snapshot} />);
    const body = container.querySelector("#owb-org-chart-body") as HTMLElement;
    fireEvent.pointerDown(body, { button: 0, pointerId: 8, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(body, { pointerId: 8, clientX: 118, clientY: 80 });
    expect(body.scrollLeft).toBe(0);
    expect(body.className).not.toContain("is-panning");
    fireEvent.pointerUp(body, { pointerId: 8 });
  });

  it("捏合缩放：ctrl+wheel 缩放且头部百分比同步，普通 wheel 不触发 (#137 review)", () => {
    const { container } = render(<OrgChart snapshot={snapshot} />);
    const body = container.querySelector("#owb-org-chart-body") as HTMLElement;
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("100%");

    fireEvent.wheel(body, { ctrlKey: true, deltaY: -100, clientX: 10, clientY: 10 });
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("110%");

    fireEvent.wheel(body, { deltaY: -100 });
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("110%");

    fireEvent.click(screen.getByRole("button", { name: "重置缩放到 100%" }));
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("100%");
  });

  it("缩放边界：连续捏合封顶 200%，连续捏开封底 50% (#137 review)", () => {
    const { container } = render(<OrgChart snapshot={snapshot} />);
    const body = container.querySelector("#owb-org-chart-body") as HTMLElement;
    for (let i = 0; i < 12; i += 1) fireEvent.wheel(body, { ctrlKey: true, deltaY: -100 });
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("200%");
    for (let i = 0; i < 20; i += 1) fireEvent.wheel(body, { ctrlKey: true, deltaY: 100 });
    expect(screen.getByRole("button", { name: "重置缩放到 100%" }).textContent).toBe("50%");
  });
});
