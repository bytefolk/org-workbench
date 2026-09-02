/** #146 i18n 骨架：恰好两个 locale（zh-CN / en），UI 只暴露这两项。
 * 无 Provider 时回退 zh-CN 全量目录，保证裸渲染的测试与旧行为一致。
 * 数据层（turn 记录、信封、组织文件）永不经过这里——只翻界面文案。 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { zhCatalog } from "./locales/zh";
import { enCatalog } from "./locales/en";

export type OwbLocale = "zh-CN" | "en";

/** 恰好两个，顺序即 UI 展示顺序；不允许第三个值。 */
export const OWB_LOCALES: readonly OwbLocale[] = ["zh-CN", "en"];

export function isOwbLocale(value: unknown): value is OwbLocale {
  return value === "zh-CN" || value === "en";
}

type Messages = Record<string, string>;

interface I18nContextValue {
  locale: OwbLocale;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  messages: zhCatalog,
});

export function OwbI18nProvider({
  locale,
  children,
}: {
  locale: OwbLocale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, messages: locale === "en" ? enCatalog : zhCatalog }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useOwbLocale(): OwbLocale {
  return useContext(I18nContext).locale;
}


/** 非 hook 的 zh 取值（模块顶层常量/默认参数用）：缺 key 回退 key，恒返回 string。 */
export function zhText(key: string): string {
  return zhCatalog[key] ?? key;
}
export type OwbT = (key: string, vars?: Record<string, string | number>) => string;

/** 查当前 locale 目录；缺 key 时回退 zh，再回退 key 本身（界面不崩、不编造）。
 * 引用按 messages 记忆化：同一 locale 内 t 身份稳定，回调/依赖数组不抖动。 */
export function useT(): OwbT {
  const { messages } = useContext(I18nContext);
  return useMemo<OwbT>(
    () => (key, vars) => {
      let text = messages[key] ?? zhCatalog[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [messages],
  );
}
