import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Empty, Input, List, Spin } from "antd";
import { Cloud, File, Image, Music2, RefreshCw, Search, Upload, X } from "lucide-react";
import type { DriveObject, DriveObjectDetailResponse, DriveObjectListResponse } from "@org-workbench/shared";

export interface DriveModuleProps {
  workspaceOpen: boolean;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function objectIcon(mime: string) {
  if (mime.startsWith("image/")) return Image;
  if (mime.startsWith("audio/")) return Music2;
  return File;
}

/**
 * Workbench-owned drive surface. mem remains the data plane; this module is
 * the one in-app management surface and only consumes the narrow whitelisted
 * bridge, never mem's private UI or storage.
 */
export function DriveModule({ workspaceOpen }: DriveModuleProps) {
  const [objects, setObjects] = useState<DriveObject[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [mocked, setMocked] = useState(false);
  const [selected, setSelected] = useState<DriveObject | null>(null);
  const [detail, setDetail] = useState<DriveObject | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadObjects = useCallback(async (needle = "") => {
    setLoading(true);
    setListError(null);
    try {
      const response = await window.owb.drive.list(needle);
      if (response.status >= 400 || !response.body) {
        throw new Error(apiErrorMessage(response.body, "网盘清单读取失败"));
      }
      const body = response.body as DriveObjectListResponse;
      setObjects(body.objects);
      setMocked(body.mocked);
    } catch (error) {
      setObjects([]);
      setMocked(false);
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    if (!workspaceOpen) {
      setObjects([]);
      setListError(null);
      return;
    }
    void loadObjects();
  }, [loadObjects, workspaceOpen]);

  const openObject = async (object: DriveObject) => {
    setSelected(object);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await window.owb.drive.detail(object.id);
      if (response.status >= 400 || !response.body) {
        throw new Error(apiErrorMessage(response.body, "网盘对象读取失败"));
      }
      setDetail((response.body as DriveObjectDetailResponse).object);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  if (!workspaceOpen) {
    return (
      <section className="owb-drive-module" aria-label="统一网盘模块">
        <Empty description="尚未打开工作区" />
      </section>
    );
  }

  return (
    <section className="owb-drive-module" aria-label="统一网盘模块">
      <header className="owb-drive-module__header">
        <div>
          <span className="owb-drive-module__eyebrow">MEM DRIVE · WORKBENCH</span>
          <h1>统一网盘</h1>
          <p>工作区文件、录音、图片与资料的统一入口；mem 负责数据与索引，Workbench 负责操作面。</p>
        </div>
        <span className={`owb-drive-module__scope ${mocked ? "is-mocked" : ""}`}>
          <span className="owb-drive-module__scope-dot" aria-hidden="true" />
          {mocked ? "LOCAL FIXTURE" : "MEM CONNECTED"}
        </span>
      </header>

      <div className="owb-drive-module__toolbar">
        <Input
          aria-label="搜索网盘"
          prefix={<Search aria-hidden="true" size={14} />}
          placeholder="搜索文件名或摘要"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={() => void loadObjects(query.trim())}
          allowClear
        />
        <Button type="primary" icon={<Search aria-hidden="true" size={14} />} onClick={() => void loadObjects(query.trim())}>
          搜索
        </Button>
        <Button aria-label="刷新网盘" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => void loadObjects(query.trim())}>
          刷新
        </Button>
        <Button
          className="owb-drive-module__upload"
          icon={<Upload aria-hidden="true" size={14} />}
          disabled
          title="等待 mem multipart 上传契约冻结"
        >
          上传文件（待接入）
        </Button>
      </div>

      {mocked ? <Alert type="info" showIcon message="MEM_URL 尚未配置，当前显示本地演示资料；不会写入真实网盘。" /> : null}
      {listError !== null ? <Alert type="error" showIcon message={listError} /> : null}

      <div className="owb-drive-module__layout">
        <section className="owb-drive-module__list" aria-label="网盘文件列表">
          <header className="owb-drive-module__list-header">
            <div>
              <span className="owb-drive-module__eyebrow">WORKSPACE OBJECTS</span>
              <h2>资料清单</h2>
            </div>
            <span className="owb-drive-module__count">
              {objects.length.toString().padStart(2, "0")} <small>OBJECTS</small>
            </span>
          </header>
          {loading ? (
            <div className="owb-drive-module__loading" role="status">
              <Spin size="small" />
              <span>正在读取统一网盘…</span>
            </div>
          ) : null}
          {!loading && listError === null ? (
            <List
              className="owb-drive-module__objects"
              dataSource={objects}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资料" /> }}
              renderItem={(object) => {
                const Icon = objectIcon(object.mime);
                return (
                  <List.Item key={object.id}>
                    <button
                      type="button"
                      className="owb-drive-module__object"
                      aria-label={`打开 ${object.name}`}
                      aria-pressed={selected?.id === object.id}
                      onClick={() => void openObject(object)}
                    >
                      <span className="owb-drive-module__object-icon" aria-hidden="true"><Icon size={16} /></span>
                      <span className="owb-drive-module__object-main">
                        <strong>{object.name}</strong>
                        <small>{object.mime} · {formatBytes(object.size)}</small>
                        {object.summary ? <span>{object.summary}</span> : null}
                      </span>
                      <span className="owb-drive-module__object-arrow" aria-hidden="true">›</span>
                    </button>
                  </List.Item>
                );
              }}
            />
          ) : null}
        </section>

        <aside className="owb-drive-module__detail" aria-label="网盘对象详情">
          {selected === null ? (
            <div className="owb-drive-module__detail-empty">
              <Cloud aria-hidden="true" size={22} />
              <strong>选择一份资料</strong>
              <span>在 Workbench 内查看对象摘要与来源信息。</span>
            </div>
          ) : (
            <>
              <header className="owb-drive-module__detail-header">
                <div>
                  <span className="owb-drive-module__eyebrow">OBJECT DETAIL</span>
                  <h2>{(detail ?? selected).name}</h2>
                </div>
                <button type="button" aria-label="关闭对象详情" onClick={() => { setSelected(null); setDetail(null); }}>
                  <X aria-hidden="true" size={15} />
                </button>
              </header>
              {detailLoading ? <Spin aria-label="对象详情加载中" /> : null}
              {detailError !== null ? <Alert type="error" showIcon message={detailError} /> : null}
              {!detailLoading && detailError === null ? (
                <div className="owb-drive-module__detail-body">
                  <p>{(detail ?? selected).summary ?? "该对象暂无摘要。"}</p>
                  <dl>
                    <div><dt>类型</dt><dd>{(detail ?? selected).mime}</dd></div>
                    <div><dt>大小</dt><dd>{formatBytes((detail ?? selected).size)}</dd></div>
                    <div><dt>来源</dt><dd>mem · 统一网盘</dd></div>
                    <div><dt>对象 ID</dt><dd title={(detail ?? selected).id}>{(detail ?? selected).id}</dd></div>
                  </dl>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
