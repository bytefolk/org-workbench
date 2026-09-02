import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Collapse, Empty, Input, Modal, Select, message } from "antd";
import { FilePlus2, Link2, Plus } from "lucide-react";
import type { DocRef, DocsCreateResponse, DocsFileListResponse, DocsFileResponse, DocsResolveResponse } from "@org-workbench/shared";
import type { PositionMentionOption } from "../turns/types";
import { DocsPanel } from "./DocsPanel";

/**
 * Document module surface (#35 S3/S4, DS-35-001 rev-1 §3/§5/§6): connects
 * the ModuleRail "文档" entry to the S2 DocsPanel through the whitelisted
 * preload bridge. S4 adds the minimal creation entry (naming + landing, no
 * editor per the frozen baseline) and the doc-ref.v1alpha1 reference face:
 * resolve pasted refs into positioned paths with deterministic states.
 */
export interface DocsModuleProps {
  workspaceOpen: boolean;
  positions: PositionMentionOption[];
  selectedPositionId: string | null;
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof (body as { message: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  return fallback;
}

interface ResolveOutcome {
  status: "ok" | "error";
  message?: string;
  resolved?: DocsResolveResponse["resolved"];
}

export function DocsModule({ workspaceOpen, positions, selectedPositionId }: DocsModuleProps) {
  const [positionId, setPositionId] = useState<string | null>(selectedPositionId);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [resolveText, setResolveText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState<ResolveOutcome | null>(null);

  useEffect(() => {
    if (selectedPositionId !== null) setPositionId(selectedPositionId);
  }, [selectedPositionId]);

  const listDocs = useCallback(async (id: string): Promise<DocsFileListResponse> => {
    const res = await window.owb.positionDocs(id);
    if (res.status >= 400 || !res.body) {
      throw new Error(apiErrorMessage(res.body, "文档列表读取失败"));
    }
    return res.body;
  }, []);

  const readDoc = useCallback(async (id: string, path: string): Promise<DocsFileResponse> => {
    const res = await window.owb.positionDocFile(id, path);
    if (res.status >= 400 || !res.body) {
      throw new Error(apiErrorMessage(res.body, "文档读取失败"));
    }
    return res.body;
  }, []);

  const submitCreate = async () => {
    if (positionId === null) return;
    const name = createName.trim();
    if (name === "") {
      setCreateError("请填写文档文件名");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await window.owb.createPositionDoc({ positionId, path: name, content: "" });
      if (res.status >= 400 || !res.body) {
        throw new Error(apiErrorMessage(res.body, "文档创建失败"));
      }
      const created: DocsCreateResponse = res.body;
      message.success(`已创建 ${created.path}`);
      setCreateOpen(false);
      setCreateName("");
      setReloadToken((token) => token + 1);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const submitResolve = async () => {
    const text = resolveText.trim();
    if (text === "") {
      setResolveOutcome({ status: "error", message: "请粘贴 doc-ref" });
      return;
    }
    let ref: DocRef;
    try {
      const parsed = JSON.parse(text) as unknown;
      ref = typeof parsed === "string" ? { uri: parsed } : (parsed as DocRef);
    } catch {
      ref = { uri: text };
    }
    setResolving(true);
    setResolveOutcome(null);
    try {
      const res = await window.owb.resolveDocRef(ref);
      if (res.status >= 400 || !res.body) {
        throw new Error(apiErrorMessage(res.body, "引用解析失败"));
      }
      setResolveOutcome({ status: "ok", resolved: res.body.resolved });
    } catch (error) {
      setResolveOutcome({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setResolving(false);
    }
  };

  if (!workspaceOpen) {
    return (
      <section className="owb-docs-module" aria-label="文档模块">
        <Empty description="尚未打开工作区" />
      </section>
    );
  }

  return (
    <section className="owb-docs-module" aria-label="文档模块">
      <header className="owb-docs-module__header">
        <div>
          <span className="owb-docs-module__eyebrow">POSITION DOCUMENTS</span>
          <h1>岗位文档</h1>
          <p>查看岗位说明、技能文件与知识库内容。</p>
        </div>
        <span className="owb-docs-module__scope">
          <span className="owb-docs-module__scope-dot" aria-hidden="true" />
          LOCAL WORKSPACE
        </span>
      </header>
      <div className="owb-docs-module__picker">
        <div className="owb-docs-module__picker-copy">
          <span>当前岗位</span>
          <small>选择后加载文件清单</small>
        </div>
        <Select
          className="owb-docs-module__select"
          aria-label="选择岗位查看文档"
          placeholder="选择岗位查看文档"
          showSearch
          optionFilterProp="label"
          allowClear
          value={positionId ?? undefined}
          onChange={(value) => setPositionId(value ?? null)}
          options={positions.map((position) => ({ value: position.id, label: position.name }))}
          popupMatchSelectWidth={false}
        />
        <Button
          className="owb-docs-module__create"
          disabled={positionId === null}
          icon={<Plus aria-hidden="true" size={14} />}
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          新建文档
        </Button>
      </div>
      <DocsPanel positionId={positionId} listDocs={listDocs} readDoc={readDoc} reloadToken={reloadToken} />
      <Collapse
        className="owb-docs-module__resolve-panel"
        items={[
          {
            key: "resolve-doc-ref",
            label: (
              <span className="owb-docs-module__resolve-label">
                <span className="owb-docs-module__resolve-icon" aria-hidden="true">
                  <Link2 size={15} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>解析引用</strong>
                  <small>粘贴 doc-ref，定位到具体岗位文件</small>
                </span>
              </span>
            ),
            children: (
              <div className="owb-docs-module__resolve">
                <Input.TextArea
                  aria-label="粘贴 doc-ref"
                  placeholder='粘贴 doc-ref（JSON 或 owb-doc://… URI）'
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  value={resolveText}
                  onChange={(event) => setResolveText(event.target.value)}
                />
                <Button className="owb-docs-module__resolve-submit" loading={resolving} icon={<FilePlus2 aria-hidden="true" size={14} />} onClick={submitResolve}>
                  解析
                </Button>
                {resolveOutcome?.status === "error" ? (
                  <Alert type="error" message={resolveOutcome.message ?? "引用解析失败"} />
                ) : null}
                {resolveOutcome?.status === "ok" && resolveOutcome.resolved ? (
                  <Alert
                    type="success"
                    message={`解析成功：${resolveOutcome.resolved.positionId}/${resolveOutcome.resolved.path}`}
                    description={`大小 ${resolveOutcome.resolved.size} 字节 · 更新于 ${resolveOutcome.resolved.modifiedAt}`}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <Modal
        title="新建文档"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
      >
        <p className="owb-docs-module__create-hint">首版无编辑器：仅命名并落盘为空文档。</p>
        <Input
          aria-label="新文档文件名"
          placeholder="handbook.md"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          onPressEnter={submitCreate}
        />
        {createError !== null ? <Alert type="error" message={createError} /> : null}
      </Modal>
    </section>
  );
}
