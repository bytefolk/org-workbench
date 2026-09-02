import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Empty, Input, List, Spin } from "antd";
import { Cloud, File, Image, Music2, RefreshCw, Search, Upload, X } from "lucide-react";
import { useT } from "@org-workbench/ui";
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
  const t = useT();
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
        throw new Error(apiErrorMessage(response.body, t("drive.listFail")));
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
  }, [t]);

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
        throw new Error(apiErrorMessage(response.body, t("drive.detailFail")));
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
      <section className="owb-drive-module" aria-label={t("drive.moduleAria")}>
        <Empty description={t("tree.notOpened")} />
      </section>
    );
  }

  return (
    <section className="owb-drive-module" aria-label={t("drive.moduleAria")}>
      <header className="owb-drive-module__header">
        <div>
          <span className="owb-drive-module__eyebrow">MEM DRIVE · WORKBENCH</span>
          <h1>{t("drive.title")}</h1>
          <p>{t("drive.subtitle")}</p>
        </div>
        <span className={`owb-drive-module__scope ${mocked ? "is-mocked" : ""}`}>
          <span className="owb-drive-module__scope-dot" aria-hidden="true" />
          {mocked ? "LOCAL FIXTURE" : "MEM CONNECTED"}
        </span>
      </header>

      <div className="owb-drive-module__toolbar">
        <Input
          aria-label={t("drive.searchAria")}
          prefix={<Search aria-hidden="true" size={14} />}
          placeholder={t("drive.searchPh")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={() => void loadObjects(query.trim())}
          allowClear
        />
        <Button type="primary" icon={<Search aria-hidden="true" size={14} />} onClick={() => void loadObjects(query.trim())}>
          {t("drive.search")}
        </Button>
        <Button aria-label={t("drive.refreshAria")} icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => void loadObjects(query.trim())}>
          {t("drive.refresh")}
        </Button>
        <Button
          className="owb-drive-module__upload"
          icon={<Upload aria-hidden="true" size={14} />}
          disabled
          title={t("drive.uploadTitle")}
        >
          {t("drive.upload")}
        </Button>
      </div>

      {mocked ? <Alert type="info" showIcon message={t("drive.mockedBanner")} /> : null}
      {listError !== null ? <Alert type="error" showIcon message={listError} /> : null}

      <div className="owb-drive-module__layout">
        <section className="owb-drive-module__list" aria-label={t("drive.listAria")}>
          <header className="owb-drive-module__list-header">
            <div>
              <span className="owb-drive-module__eyebrow">WORKSPACE OBJECTS</span>
              <h2>{t("drive.listTitle")}</h2>
            </div>
            <span className="owb-drive-module__count">
              {objects.length.toString().padStart(2, "0")} <small>OBJECTS</small>
            </span>
          </header>
          {loading ? (
            <div className="owb-drive-module__loading" role="status">
              <Spin size="small" />
              <span>{t("drive.loading")}</span>
            </div>
          ) : null}
          {!loading && listError === null ? (
            <List
              className="owb-drive-module__objects"
              dataSource={objects}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("drive.empty")} /> }}
              renderItem={(object) => {
                const Icon = objectIcon(object.mime);
                return (
                  <List.Item key={object.id}>
                    <button
                      type="button"
                      className="owb-drive-module__object"
                      aria-label={t("drive.openObject", { name: object.name })}
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

        <aside className="owb-drive-module__detail" aria-label={t("drive.detailAria")}>
          {selected === null ? (
            <div className="owb-drive-module__detail-empty">
              <Cloud aria-hidden="true" size={22} />
              <strong>{t("drive.detailEmptyTitle")}</strong>
              <span>{t("drive.detailEmptyHint")}</span>
            </div>
          ) : (
            <>
              <header className="owb-drive-module__detail-header">
                <div>
                  <span className="owb-drive-module__eyebrow">OBJECT DETAIL</span>
                  <h2>{(detail ?? selected).name}</h2>
                </div>
                <button type="button" aria-label={t("drive.closeDetail")} onClick={() => { setSelected(null); setDetail(null); }}>
                  <X aria-hidden="true" size={15} />
                </button>
              </header>
              {detailLoading ? <Spin aria-label={t("drive.detailLoading")} /> : null}
              {detailError !== null ? <Alert type="error" showIcon message={detailError} /> : null}
              {!detailLoading && detailError === null ? (
                <div className="owb-drive-module__detail-body">
                  <p>{(detail ?? selected).summary ?? t("drive.noSummary")}</p>
                  <dl>
                    <div><dt>{t("drive.metaType")}</dt><dd>{(detail ?? selected).mime}</dd></div>
                    <div><dt>{t("drive.metaSize")}</dt><dd>{formatBytes((detail ?? selected).size)}</dd></div>
                    <div><dt>{t("drive.metaSource")}</dt><dd>{t("drive.sourceMem")}</dd></div>
                    <div><dt>{t("drive.metaId")}</dt><dd title={(detail ?? selected).id}>{(detail ?? selected).id}</dd></div>
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
