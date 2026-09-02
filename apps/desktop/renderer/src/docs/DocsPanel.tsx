import { useEffect, useState } from "react";
import { Alert, Empty, List, Spin, message } from "antd";
import { formatDocRefUri } from "@org-workbench/shared/docs";
import { useT } from "@org-workbench/ui";
import type { DocsFileEntry, DocsFileListResponse, DocsFileResponse } from "@org-workbench/shared";
import { DocViewer } from "./DocViewer";

/**
 * Document routing surface (#35 S2/S4, DS-35-001 rev-1 §3/§5): routes a
 * position's document files into the S1 DocViewer. Loaders are injected so
 * the surface stays testable without the preload bridge. S4 adds the
 * `reloadToken` re-list trigger and a per-file doc-ref copy action; the
 * reference shape stays the frozen doc-ref.v1alpha1.
 */
export interface DocsPanelProps {
  positionId: string | null;
  listDocs(positionId: string): Promise<DocsFileListResponse>;
  readDoc(positionId: string, path: string): Promise<DocsFileResponse>;
  /** Bumped by the creator to force a re-list after a successful create. */
  reloadToken?: number;
}

export function DocsPanel({ positionId, listDocs, readDoc, reloadToken = 0 }: DocsPanelProps) {
  const t = useT();
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
  }, [positionId, listDocs, reloadToken]);

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

  const copyRef = async (entry: DocsFileEntry) => {
    if (positionId === null) return;
    const ref = JSON.stringify({
      uri: formatDocRefUri(positionId, entry.path),
      version: entry.modifiedAt,
    });
    try {
      await navigator.clipboard.writeText(ref);
      message.success(t("docs.refCopied"));
    } catch {
      message.error(t("docs.clipboardUnavailable"));
    }
  };

  return (
    <section className="owb-docs-panel" aria-label={t("docs.panelAria")}>
      {positionId === null ? (
        <Empty description={t("docs.pickFromTree")} />
      ) : (
        <>
          {listing ? <Spin aria-label={t("docs.listing")} /> : null}
          {listError !== null ? <Alert type="error" message={listError} /> : null}
          {!listing && listError === null ? (
            <List
              size="small"
              dataSource={files}
              locale={{ emptyText: t("docs.empty") }}
              renderItem={(entry) => (
                <List.Item
                  key={entry.path}
                  actions={[
                    <button
                      key="copy-ref"
                      type="button"
                      className="owb-docs-panel__copy-ref"
                      aria-label={t("docs.copyRefAria", { path: entry.path })}
                      onClick={() => copyRef(entry)}
                    >
                      {t("docs.copyRef")}
                    </button>,
                  ]}
                >
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
          {reading ? <Spin aria-label={t("docs.reading")} /> : null}
          {readError !== null ? <Alert type="error" message={readError} /> : null}
          {doc !== null ? <DocViewer source={doc.content} version={doc.version} title={doc.path} /> : null}
        </>
      )}
    </section>
  );
}
