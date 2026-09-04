/**
 * #146 CJK gate: apps/desktop/renderer/src 与 packages/ui/src 的所有
 * .ts/.tsx（排除 locales/ 目录与本测试自身）里，**字符串字面量**内不允许再出现
 * CJK 表意文字——用户可见中文必须走 zh/en 目录（locales/ 除外）。
 *
 * 判定前先剥 // 与 /* ... *\/ 注释；字符串扫描是单遍状态机，正确处理：
 *  - '...' / "..." 的引号转义（\\、\'、\"）；
 *  - 模板串 \`...\` 及其 ${...} 嵌套（递归回到代码态，花括号配对）；
 *  - 只报字符串字面量内的 CJK（[一-龥]）：注释与 JSX 文本不在判定面内，
 *    拿不准就保守不报。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Walk upward from the cwd until both scan roots exist (works from the repo
 * root, from apps/desktop, or from anywhere inside the worktree). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 12; depth += 1) {
    if (
      existsSync(join(dir, "apps", "desktop", "renderer", "src")) &&
      existsSync(join(dir, "packages", "ui", "src"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("i18n-cjk-gate: could not locate the repo root from " + process.cwd());
}

const REPO_ROOT = findRepoRoot();
const SCAN_ROOTS = [
  join(REPO_ROOT, "apps", "desktop", "renderer", "src"),
  join(REPO_ROOT, "packages", "ui", "src"),
];
const EXCLUDED_DIRS = new Set(["locales"]);
const SELF = join(REPO_ROOT, "apps", "desktop", "renderer", "test", "i18n-cjk-gate.test.ts");

interface Violation {
  file: string;
  line: number;
  column: number;
}

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry)) continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

const isCjk = (ch: string): boolean => ch >= "\u4e00" && ch <= "\u9fa5";

/**
 * Single-pass scanner. Frame stack semantics:
 *  - frames: "code" | "tpl"; the bottom frame is always "code".
 *  - A "${" inside a tpl frame pushes a "code" frame; its matching "}" is
 *    found via a per-frame brace counter (nested object literals included)
 *    and pops back to the tpl frame.
 * Strings ('...'/\"...\") are tracked globally with backslash escaping; a
 * quote inside a ${...} expression is handled because the string state takes
 * precedence over frame transitions until the string closes.
 */
function scanStringLiterals(source: string): Violation[] {
  const violations: Violation[] = [];
  let line = 1;
  let column = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let stringQuote: string | null = null;
  const frames: Array<"code" | "tpl"> = ["code"];
  const braceDepth: number[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    const next = source[i + 1];
    column += 1;

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
        column += 1;
      }
    } else if (stringQuote !== null) {
      if (ch === "\\") {
        i += 1;
        column += 1;
      } else if (ch === stringQuote) {
        stringQuote = null;
      } else if (isCjk(ch)) {
        violations.push({ file: "", line, column });
      }
    } else if (frames[frames.length - 1] === "tpl") {
      if (ch === "\\") {
        i += 1;
        column += 1;
      } else if (ch === "`") {
        frames.pop();
        braceDepth.pop();
      } else if (ch === "$" && next === "{") {
        frames.push("code");
        braceDepth.push(0);
        i += 1;
        column += 1;
      } else if (isCjk(ch)) {
        violations.push({ file: "", line, column });
      }
    } else {
      // code frame
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i += 1;
        column += 1;
      } else if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 1;
        column += 1;
      } else if (ch === "'" || ch === "\"") {
        stringQuote = ch;
      } else if (ch === "`") {
        frames.push("tpl");
        braceDepth.push(-1);
      } else if (frames.length > 1 && ch === "{") {
        braceDepth[braceDepth.length - 1] = (braceDepth[braceDepth.length - 1] ?? 0) + 1;
      } else if (frames.length > 1 && ch === "}") {
        const depth = braceDepth[braceDepth.length - 1] ?? 0;
        if (depth === 0) {
          frames.pop();
          braceDepth.pop();
        } else {
          braceDepth[braceDepth.length - 1] = depth - 1;
        }
      }
    }

    if (ch === "\n") {
      line += 1;
      column = 0;
    }
  }
  return violations;
}

/** Run the scanner over one file and stamp each violation with its path. */
function scanFile(file: string): Violation[] {
  const source = readFileSync(file, "utf8");
  return scanStringLiterals(source).map((violation) => ({ ...violation, file }));
}

describe("#146 CJK gate: UI copy lives in the catalogs, not in string literals", () => {
  it("finds no CJK inside string literals under renderer/src and packages/ui/src", () => {
    const files = SCAN_ROOTS.flatMap(collectSourceFiles).filter((file) => file !== SELF);
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap(scanFile);
    const report = violations
      .map((v) => `${relative(REPO_ROOT, v.file)}:${v.line}:${v.column}`)
      .join("\n");
    expect(violations, `CJK string literals must move to the i18n catalogs:\n${report}`).toEqual([]);
  });
});
