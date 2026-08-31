import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HireDrawer } from "../src/org/HireDrawer";
import { pickSelectOption } from "./select-helper";

const SUCCESS = {
  status: 200,
  body: {
    status: "hired" as const,
    positionId: "docs-writer",
    version: { seq: 6, updatedAt: "2026-08-31T00:00:00.000Z" },
  },
};

function fillRequiredFields(id = "docs-writer", name = "文档负责人"): void {
  fireEvent.change(screen.getByPlaceholderText("员工姓名（≤24 字）"), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText("小写字母、数字与连字符，≤64 位"), { target: { value: id } });
  fireEvent.change(screen.getByPlaceholderText("≤500 字"), { target: { value: "维护文档" } });
  const [taskTokens, dayTokens] = screen.getAllByPlaceholderText("正整数");
  fireEvent.change(taskTokens!, { target: { value: "20000" } });
  fireEvent.change(dayTokens!, { target: { value: "200000" } });
}

function expectFailClosedDefaults(): void {
  expect(screen.getByRole("combobox", { name: "运行模式" }).closest(".ant-select")).toHaveTextContent("需审批（approval_required）");
  const network = screen.getByRole("combobox", { name: "网络访问" });
  expect(network).toBeDisabled();
  expect(network.closest(".ant-select")).toHaveTextContent("拒绝网络（deny）");
  expect(screen.queryByText(/host_policy/)).not.toBeInTheDocument();
}

describe("HireDrawer capability and lifecycle boundaries", () => {
  it("offers deny only and resets every create field on open and retry success", async () => {
    const hire = vi.fn()
      .mockResolvedValueOnce({
        status: 503,
        body: { status: "failed", code: "engine_unavailable", message: "offline", retryable: true },
      })
      .mockResolvedValueOnce(SUCCESS)
      .mockResolvedValueOnce({
        ...SUCCESS,
        body: { ...SUCCESS.body, positionId: "release-writer" },
      });
    Object.defineProperty(window, "owb", {
      configurable: true,
      value: { hire, onEvent: vi.fn().mockReturnValue(() => undefined) },
    });
    const onClose = vi.fn();
    const onHired = vi.fn();
    const props = {
      positions: [{ id: "repo-owner", name: "代码库负责人" }],
      presetReportTo: "repo-owner",
      onClose,
      onHired,
    };
    const { rerender } = render(<HireDrawer {...props} open />);

    expectFailClosedDefaults();
    pickSelectOption("运行模式", "只读");
    fireEvent.change(screen.getByPlaceholderText("员工姓名（≤24 字）"), { target: { value: "不应继承" } });

    // An external parent close can bypass the drawer's own close handler; the
    // next open must still start from a fresh, fail-closed draft.
    rerender(<HireDrawer {...props} open={false} />);
    rerender(<HireDrawer {...props} open />);
    await waitFor(() => expect(screen.getByPlaceholderText("员工姓名（≤24 字）")).toHaveValue(""));
    expectFailClosedDefaults();

    pickSelectOption("运行模式", "只读");
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "开始创建" }));
    expect(await screen.findByText("engine_unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^重\s*试$/ }));

    await waitFor(() => expect(onHired).toHaveBeenCalledWith("docs-writer", "文档负责人"));
    expect(hire).toHaveBeenNthCalledWith(1, expect.objectContaining({
      mode: "read_only",
      network: "deny",
    }));
    expect(hire).toHaveBeenNthCalledWith(2, expect.objectContaining({
      mode: "read_only",
      network: "deny",
    }));

    // The retry-success path shares the same full reset as direct success.
    expect(screen.getByPlaceholderText("员工姓名（≤24 字）")).toHaveValue("");
    expectFailClosedDefaults();

    fillRequiredFields("release-writer", "发布文档负责人");
    fireEvent.click(screen.getByRole("button", { name: "开始创建" }));
    await waitFor(() => expect(hire).toHaveBeenCalledTimes(3));
    expect(hire).toHaveBeenNthCalledWith(3, expect.objectContaining({
      positionId: "release-writer",
      mode: "approval_required",
      network: "deny",
    }));
    expect(screen.getByPlaceholderText("员工姓名（≤24 字）")).toHaveValue("");
    expectFailClosedDefaults();
  });
});
