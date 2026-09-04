import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsCreateResponse, DocsFileListResponse, DocsResolveResponse } from "@org-workbench/shared";
import { DocsModule } from "../src/docs/DocsModule";
import type { OwbBridge } from "../src/owb";

/** #35 S4 creation/reference face: the docs module consumes the additive
 * bridge channels (createPositionDoc/resolveDocRef) and copies frozen
 * doc-ref.v1alpha1 values — no editor, no #36 index/search surface. */

const positions = [{ id: "repo-owner", name: "Repo Owner" }];

const listBody: DocsFileListResponse = {
  schemaVersion: "docs-file-list.v1",
  positionId: "repo-owner",
  files: [
    { path: "handbook.md", kind: "file", size: 128, modifiedAt: "2026-08-27T00:00:00.000Z" },
  ],
};

const createBody: DocsCreateResponse = {
  schemaVersion: "docs-create.v1",
  positionId: "repo-owner",
  path: "runbook.md",
  version: "2026-08-27T01:00:00.000Z",
  size: 10,
  assetId: "0e2f4a6b-8c0d-4e1f-9a2b-3c4d5e6f7081",
};

const resolveBody: DocsResolveResponse = {
  schemaVersion: "docs-resolve.v1",
  ref: { uri: "owb-doc://repo-owner/SKILL.md" },
  resolved: {
    positionId: "repo-owner",
    path: "SKILL.md",
    size: 512,
    modifiedAt: "2026-08-26T00:00:00.000Z",
  },
};

function installBridge(overrides: Partial<OwbBridge> = {}) {
  const bridge = {
    positionDocs: vi.fn().mockResolvedValue({ status: 200, body: listBody }),
    positionDocFile: vi.fn().mockResolvedValue({ status: 200, body: null }),
    createPositionDoc: vi.fn().mockResolvedValue({ status: 201, body: createBody }),
    resolveDocRef: vi.fn().mockResolvedValue({ status: 200, body: resolveBody }),
    ...overrides,
  };
  window.owb = bridge as unknown as OwbBridge;
  return bridge;
}

describe("DocsModule create + reference face (#35 S4)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("creates a doc via naming-only modal and re-lists the position", async () => {
    const bridge = installBridge();
    render(<DocsModule workspaceOpen positions={positions} selectedPositionId="repo-owner" />);
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "新建文档" }));
    const input = await screen.findByLabelText("新文档文件名");
    fireEvent.change(input, { target: { value: "runbook.md" } });
    fireEvent.click(screen.getByRole("button", { name: /^创\s?建$/ }));

    await waitFor(() =>
      expect(bridge.createPositionDoc).toHaveBeenCalledWith({
        positionId: "repo-owner",
        path: "runbook.md",
        content: "",
      }),
    );
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已创建 runbook.md")).toBeTruthy();
  });

  it("surfaces the docs_exists conflict without closing the modal", async () => {
    const bridge = installBridge({
      createPositionDoc: vi.fn().mockResolvedValue({
        status: 409,
        body: { code: "docs_exists", message: "文档已存在", retryable: false },
      }) as unknown as OwbBridge["createPositionDoc"],
    });
    render(<DocsModule workspaceOpen positions={positions} selectedPositionId="repo-owner" />);
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "新建文档" }));
    const input = await screen.findByLabelText("新文档文件名");
    fireEvent.change(input, { target: { value: "handbook.md" } });
    fireEvent.click(screen.getByRole("button", { name: /^创\s?建$/ }));

    expect(await screen.findByText("文档已存在")).toBeTruthy();
    expect(screen.getByLabelText("新文档文件名")).toBeTruthy();
  });

  it("copies the frozen doc-ref.v1alpha1 JSON for a listed file", async () => {
    const bridge = installBridge();
    render(<DocsModule workspaceOpen positions={positions} selectedPositionId="repo-owner" />);
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalled());

    fireEvent.click(await screen.findByLabelText("复制引用 handbook.md"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        JSON.stringify({
          uri: "owb-doc://repo-owner/handbook.md",
          version: "2026-08-27T00:00:00.000Z",
        }),
      ),
    );
    expect(await screen.findByText("引用已复制")).toBeTruthy();
  });

  it("resolves a pasted doc-ref into a positioned path", async () => {
    const bridge = installBridge();
    render(<DocsModule workspaceOpen positions={positions} selectedPositionId="repo-owner" />);
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalled());

    fireEvent.click(screen.getByText("解析引用"));
    const input = await screen.findByLabelText("粘贴 doc-ref");
    fireEvent.change(input, { target: { value: '{"uri":"owb-doc://repo-owner/SKILL.md"}' } });
    fireEvent.click(screen.getByRole("button", { name: /^解\s?析$/ }));

    await waitFor(() =>
      expect(bridge.resolveDocRef).toHaveBeenCalledWith({ uri: "owb-doc://repo-owner/SKILL.md" }),
    );
    expect(await screen.findByText("解析成功：repo-owner/SKILL.md")).toBeTruthy();
    expect(screen.getByText("大小 512 字节 · 更新于 2026-08-26T00:00:00.000Z")).toBeTruthy();
  });

  it("accepts a bare uri and surfaces the doc_ref_invalid message", async () => {
    const bridge = installBridge({
      resolveDocRef: vi.fn().mockResolvedValue({
        status: 400,
        body: { code: "doc_ref_invalid", message: "doc-ref uri must be owb-doc://<positionId>/<path>", retryable: false },
      }) as unknown as OwbBridge["resolveDocRef"],
    });
    render(<DocsModule workspaceOpen positions={positions} selectedPositionId="repo-owner" />);
    await waitFor(() => expect(bridge.positionDocs).toHaveBeenCalled());

    fireEvent.click(screen.getByText("解析引用"));
    const input = await screen.findByLabelText("粘贴 doc-ref");
    fireEvent.change(input, { target: { value: "https://elsewhere/SKILL.md" } });
    fireEvent.click(screen.getByRole("button", { name: /^解\s?析$/ }));

    await waitFor(() =>
      expect(bridge.resolveDocRef).toHaveBeenCalledWith({ uri: "https://elsewhere/SKILL.md" }),
    );
    expect(
      await screen.findByText("doc-ref uri must be owb-doc://<positionId>/<path>"),
    ).toBeTruthy();
  });
});
