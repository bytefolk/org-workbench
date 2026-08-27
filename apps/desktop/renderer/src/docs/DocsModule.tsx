import { useCallback, useEffect, useState } from "react";
import { Empty, Select } from "antd";
import type { DocsFileListResponse, DocsFileResponse } from "@org-workbench/shared";
import type { PositionMentionOption } from "../turns/types";
import { DocsPanel } from "./DocsPanel";

/**
 * Document module surface (#35 S3, DS-35-001 rev-1 §5): connects the
 * ModuleRail "文档" entry to the S2 DocsPanel through the whitelisted preload
 * bridge. The picker reuses the org-tree position options so documents are
 * browsable without returning to the tree. Document creation and references
 * belong to S4 and stay out of scope here.
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

export function DocsModule({ workspaceOpen, positions, selectedPositionId }: DocsModuleProps) {
  const [positionId, setPositionId] = useState<string | null>(selectedPositionId);

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

  if (!workspaceOpen) {
    return (
      <section className="owb-docs-module" aria-label="文档模块">
        <Empty description="尚未打开工作区" />
      </section>
    );
  }

  return (
    <section className="owb-docs-module" aria-label="文档模块">
      <div className="owb-docs-module__picker">
        <Select
          aria-label="选择岗位查看文档"
          placeholder="选择岗位查看文档"
          showSearch
          optionFilterProp="label"
          allowClear
          value={positionId ?? undefined}
          onChange={(value) => setPositionId(value ?? null)}
          options={positions.map((position) => ({ value: position.id, label: position.name }))}
          popupMatchSelectWidth={false}
          style={{ minWidth: 240 }}
        />
      </div>
      <DocsPanel positionId={positionId} listDocs={listDocs} readDoc={readDoc} />
    </section>
  );
}
