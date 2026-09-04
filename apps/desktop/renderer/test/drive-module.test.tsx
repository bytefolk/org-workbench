import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriveModule } from "../src/drive/DriveModule";

const objects = [
  {
    id: "mem-001",
    name: "会议纪要-Q3.md",
    size: 4821,
    mime: "text/markdown",
    createdAt: "2026-08-30T09:14:22.000Z",
    summary: "Q3 规划复盘与关键风险。",
  },
  {
    id: "mem-002",
    name: "客户访谈.m4a",
    size: 2_318_411,
    mime: "audio/mp4",
    createdAt: "2026-08-27T15:02:08.000Z",
  },
];

function installBridge() {
  const list = vi.fn().mockResolvedValue({
    status: 200,
    body: { schemaVersion: "drive-object-list.v1", objects, mocked: true },
  });
  const detail = vi.fn().mockResolvedValue({
    status: 200,
    body: { schemaVersion: "drive-object.v1", object: objects[0], mocked: true },
  });
  Object.defineProperty(window, "owb", {
    configurable: true,
    value: { drive: { list, detail } },
  });
  return { list, detail };
}

describe("Workbench 统一网盘模块", () => {
  it("在当前客户端展示 mem 对象并打开详情", async () => {
    const bridge = installBridge();
    render(<DriveModule workspaceOpen />);

    expect(await screen.findByRole("heading", { name: "统一网盘" })).toBeInTheDocument();
    expect(await screen.findByText("会议纪要-Q3.md")).toBeInTheDocument();
    expect(screen.getByText("本地样例")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传文件（待接入）" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "打开 会议纪要-Q3.md" }));
    expect(await screen.findByText("Q3 规划复盘与关键风险。")).toBeInTheDocument();
    expect(bridge.detail).toHaveBeenCalledWith("mem-001");
  });

  it("搜索仍然通过 Workbench 白名单桥接到统一网盘", async () => {
    const bridge = installBridge();
    render(<DriveModule workspaceOpen />);
    await screen.findByText("会议纪要-Q3.md");

    fireEvent.change(screen.getByRole("textbox", { name: "搜索网盘" }), { target: { value: "客户" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(bridge.list).toHaveBeenLastCalledWith("客户"));
  });

  it("工作区未打开时不读取 mem", () => {
    const bridge = installBridge();
    render(<DriveModule workspaceOpen={false} />);
    expect(screen.getByText("尚未打开工作区")).toBeInTheDocument();
    expect(bridge.list).not.toHaveBeenCalled();
  });
});
