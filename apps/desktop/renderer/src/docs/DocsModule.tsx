import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Collapse, Empty, Input, Modal, Select, Tabs, message } from "antd";
import { useT } from "@org-workbench/ui";
import { FilePlus2, Link2, Plus } from "lucide-react";
import type {
  DocPlaneDetailResponse,
  DocPlaneListResponse,
  DocRef,
  DocsCreateResponse,
  DocsFileListResponse,
  DocsFileResponse,
  DocsResolveResponse,
} from "@org-workbench/shared";
import type { PositionMentionOption } from "../turns/types";
import { DocPlanePanel } from "./DocPlanePanel";
import type { DocPlaneDetailLoadResult, DocPlaneListLoadResult } from "./DocPlanePanel";
import { DocsPanel } from "./DocsPanel";

/**
 * Document module surface (#35 S3/S4 + R2, DS-35-001 rev-1 §3/§5/§6):
 * connects the ModuleRail "文档" entry to two document surfaces:
 *
 *  - the frozen position-scoped file surface (S2/S4 DocsPanel + creator +
 *    doc-ref resolver), and
 *  - the new external doc-plane bridge (R2 MVP) that talks to
 *    `bytefolk/doc` through the shell-owned proxy. The proxy fails closed
 *    when `ORG_WORKBENCH_DOC_URL` is unset, and this module surfaces the
 *    matching configuration hint instead of pretending everything is fine.
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

function apiErrorCode(body: unknown): string | null {
  if (
    body &&
    typeof body === "object" &&
    "code" in body &&
    typeof (body as { code: unknown }).code === "string"
  ) {
    return (body as { code: string }).code;
  }
  return null;
}

interface ResolveOutcome {
  status: "ok" | "error";
  message?: string;
  resolved?: DocsResolveResponse["resolved"];
}

export function DocsModule({ workspaceOpen, positions, selectedPositionId }: DocsModuleProps) {
  const t = useT();
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
      throw new Error(apiErrorMessage(res.body, t("docs.listFail")));
    }
    return res.body;
  }, [t]);

  const readDoc = useCallback(async (id: string, path: string): Promise<DocsFileResponse> => {
    const res = await window.owb.positionDocFile(id, path);
    if (res.status >= 400 || !res.body) {
      throw new Error(apiErrorMessage(res.body, t("docs.readFail")));
    }
    return res.body;
  }, [t]);

  const docPlaneList = useCallback(async (query: string): Promise<DocPlaneListLoadResult> => {
    const res = await window.owb.docPlaneList(query);
    if (res.status >= 200 && res.status < 300 && res.body) {
      return { kind: "ok", response: res.body as DocPlaneListResponse };
    }
    const code = apiErrorCode(res.body);
    if (code === "doc_plane_unconfigured") {
      return {
        kind: "unconfigured",
        message: apiErrorMessage(res.body, "尚未配置外部 doc 服务器"),
      };
    }
    return {
      kind: "error",
      message: apiErrorMessage(res.body, "外部文档列表读取失败"),
    };
  }, []);

  const docPlaneDetail = useCallback(async (id: string): Promise<DocPlaneDetailLoadResult> => {
    const res = await window.owb.docPlaneDetail(id);
    if (res.status >= 200 && res.status < 300 && res.body) {
      return { kind: "ok", response: res.body as DocPlaneDetailResponse };
    }
    return {
      kind: "error",
      message: apiErrorMessage(res.body, "外部文档读取失败"),
    };
  }, []);

  const submitCreate = async () => {
    if (positionId === null) return;
    const name = createName.trim();
    if (name === "") {
      setCreateError(t("docs.nameRequired"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await window.owb.createPositionDoc({ positionId, path: name, content: "" });
      if (res.status >= 400 || !res.body) {
        throw new Error(apiErrorMessage(res.body, t("docs.createFail")));
      }
      const created: DocsCreateResponse = res.body;
      message.success(t("docs.created", { path: created.path }));
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
      setResolveOutcome({ status: "error", message: t("docs.pasteRefEmpty") });
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
        throw new Error(apiErrorMessage(res.body, t("docs.resolveFail")));
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
      <section className="owb-docs-module" aria-label={t("docs.moduleAria")}>
        <Empty description={t("tree.notOpened")} />
      </section>
    );
  }

  const positionSurface = (
    <>
      <div className="owb-docs-module__picker">
        <div className="owb-docs-module__picker-copy">
          <span>{t("docs.pickerTitle")}</span>
          <small>{t("docs.pickerHint")}</small>
        </div>
        <Select
          className="owb-docs-module__select"
          aria-label={t("docs.pickPosition")}
          placeholder={t("docs.pickPosition")}
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
          {t("docs.create")}
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
                  <strong>{t("docs.resolve")}</strong>
                  <small>{t("docs.resolveHint")}</small>
                </span>
              </span>
            ),
            children: (
              <div className="owb-docs-module__resolve">
                <Input.TextArea
                  aria-label={t("docs.pasteRefAria")}
                  placeholder={t("docs.resolvePh")}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  value={resolveText}
                  onChange={(event) => setResolveText(event.target.value)}
                />
                <Button className="owb-docs-module__resolve-submit" loading={resolving} icon={<FilePlus2 aria-hidden="true" size={14} />} onClick={submitResolve}>
                  {t("docs.resolveAction")}
                </Button>
                {resolveOutcome?.status === "error" ? (
                  <Alert type="error" message={resolveOutcome.message ?? t("docs.resolveFail")} />
                ) : null}
                {resolveOutcome?.status === "ok" && resolveOutcome.resolved ? (
                  <Alert
                    type="success"
                    message={t("docs.resolved", { position: resolveOutcome.resolved.positionId, path: resolveOutcome.resolved.path })}
                    description={t("docs.resolvedMeta", { size: resolveOutcome.resolved.size, modifiedAt: resolveOutcome.resolved.modifiedAt })}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </>
  );

  return (
    <section className="owb-docs-module" aria-label={t("docs.moduleAria")}>
      <header className="owb-docs-module__header">
        <div>
          <span className="owb-docs-module__eyebrow">POSITION DOCUMENTS</span>
          <h1>{t("docs.moduleTitle")}</h1>
          <p>{t("docs.moduleSubtitle")}</p>
        </div>
        <span className="owb-docs-module__scope">
          <span className="owb-docs-module__scope-dot" aria-hidden="true" />
          LOCAL WORKSPACE
        </span>
      </header>
      <Tabs
        defaultActiveKey="position"
        items={[
          { key: "position", label: t("docs.moduleTitle"), children: positionSurface },
          {
            key: "plane",
            label: t("docs.tabPlane"),
            children: <DocPlanePanel listDocs={docPlaneList} readDoc={docPlaneDetail} />,
          },
        ]}
      />
      <Modal
        title={t("docs.create")}
        open={createOpen}
        okText={t("docs.createAction")}
        cancelText={t("dlg.cancel")}
        confirmLoading={creating}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
      >
        <p className="owb-docs-module__create-hint">{t("docs.noEditorHint")}</p>
        <Input
          aria-label={t("docs.fileNameAria")}
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
