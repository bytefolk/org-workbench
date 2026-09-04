export interface FrontmatterSplit {
  data: Record<string, string>;
  body: string;
  hasFrontmatter: boolean;
}

const FENCE = "---";

/**
 * Splits a leading `---\nkey: value\n---` block from markdown source.
 * Deliberately minimal: flat `key: value` lines only, fail-closed — a
 * missing closing fence or a malformed line treats the whole input as body.
 */
export function splitFrontmatter(source: string): FrontmatterSplit {
  const bodyFallback: FrontmatterSplit = { data: {}, body: source, hasFrontmatter: false };
  if (!source.startsWith(FENCE + "\n")) return bodyFallback;
  const closingIndex = source.indexOf("\n" + FENCE, FENCE.length + 1);
  if (closingIndex === -1) return bodyFallback;
  const rawBlock = source.slice(FENCE.length + 1, closingIndex);
  const afterFence = source.slice(closingIndex + FENCE.length + 1);
  const data: Record<string, string> = {};
  for (const line of rawBlock.split("\n")) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return bodyFallback;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) || value === "") return bodyFallback;
    data[key] = value;
  }
  if (afterFence === "") return { data, body: "", hasFrontmatter: true };
  if (!afterFence.startsWith("\n")) return bodyFallback;
  const rest = afterFence.slice(1);
  return { data, body: rest.startsWith("\n") ? rest.slice(1) : rest, hasFrontmatter: true };
}
