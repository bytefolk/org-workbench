import { useEffect, useState } from "react";
import { Alert, Empty, List, Spin } from "antd";
import type { DocsFileEntry, DocsFileListResponse, DocsFileResponse } from "@org-workbench/shared";
import { DocViewer } from "./DocViewer";

/**
 * Document routing surface (#35 S2, DS-35-001 rev-1 §5): routes a position's
 * document files into the S1 DocViewer. Loaders are injected so the surface
 * stays testable without the preload bridge; ModuleRail entry wiring belongs
 * to S3 and is deliberately absent here.
 */
export interface DocsPanelProps {
  positionId: string | null;
  listDocs(positionId: string): Promise<DocsFileListResponse>;
  readDoc(positionId: string, path: string): Promise<DocsFileResponse>;
}

export function DocsPanel({ positionId, listDocs, readDoc }: DocsPanelProps) {
  const [files, setFiles] = useState<DocsFileEntry[]>([]);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocsFileResponse | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setDoc(null);
    setReadError(null);
    if (positionId === null) {
      setFiles([]);
      setListError(null);
      return;
    }
    let cancelled = false;
    setListing(true);
    setListError(null);
    listDocs(positionId)
      .then((response) => {
        if (cancelled) return;
        setFiles(response.files);
      })
      .catch((error) => {
        if (cancelled) return;
        setFiles([]);
        setListError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [positionId, listDocs]);

  const openFile = (path: string) => {
    if (positionId === null) return;
    setSelected(path);
    setDoc(null);
    setReadError(null);
    setReading(true);
    readDoc(positionId, path)
      .then((response) => setDoc(response))
      .catch((error) => setReadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReading(false));
  };

  return (
    <section className="owb-docs-panel" aria-label="岗位文档">
      {positionId === null ? (
        <Empty description="先从组织树选择岗位" />
      ) : (
        <>
          {listing ? <Spin aria-label="文档列表加载中" /> : null}
          {listError !== null ? <Alert type="error" message={listError} /> : null}
          {!listing && listError === null ? (
            <List
              size="small"
              dataSource={files}
              locale={{ emptyText: "该岗位暂无文档" }}
              renderItem={(entry) => (
                <List.Item key={entry.path}>
                  <button
                    type="button"
                    className="owb-docs-panel__file"
                    aria-pressed={selected === entry.path}
                    onClick={() => openFile(entry.path)}
                  >
                    {entry.path}
                  </button>
                </List.Item>
              )}
            />
          ) : null}
          {reading ? <Spin aria-label="文档加载中" /> : null}
          {readError !== null ? <Alert type="error" message={readError} /> : null}
          {doc !== null ? <DocViewer source={doc.content} version={doc.version} title={doc.path} /> : null}
        </>
      )}
    </section>
  );
}
