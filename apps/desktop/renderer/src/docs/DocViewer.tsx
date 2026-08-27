import { Card, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import { splitFrontmatter } from "./frontmatter";

export interface DocViewerProps {
  /** Raw markdown source, optionally prefixed with a `---` frontmatter block. */
  source: string;
  /** File-level version provenance (digest or mtime), supplied by the wiring slices (S2/S3). */
  version?: string;
  /** Explicit title override; falls back to frontmatter `name`, then a generic label. */
  title?: string;
}

const META_LABEL: Record<string, string> = {
  name: "名称",
  description: "描述",
};

export function DocViewer({ source, version, title }: DocViewerProps) {
  const { data, body, hasFrontmatter } = splitFrontmatter(source);
  const heading = title ?? data.name ?? "文档";
  const metaEntries = Object.entries(data).filter(([key]) => key !== "name");
  return (
    <Card
      className="owb-doc-viewer"
      title={<Typography.Text strong>{heading}</Typography.Text>}
      extra={version !== undefined ? <Tag bordered>版本 {version}</Tag> : null}
    >
      {hasFrontmatter && metaEntries.length > 0 ? (
        <dl className="owb-doc-viewer__meta">
          {metaEntries.map(([key, value]) => (
            <div key={key}>
              <Typography.Text type="secondary">{META_LABEL[key] ?? key}</Typography.Text>{" "}
              <Typography.Text>{value}</Typography.Text>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="owb-doc-viewer__body">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </Card>
  );
}
