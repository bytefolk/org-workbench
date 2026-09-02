/** #146 语言切换：恰好两态（zh-CN ⇄ en），按钮文案即目标语言的入口字形
 * （中文界面显示 "EN"，英文界面显示 "中"），aria/title 用各自目录文案。 */
import { Languages } from "lucide-react";
import { useT, type OwbLocale } from "@org-workbench/ui";

export function LocaleToggle({
  locale,
  onChange,
}: {
  locale: OwbLocale;
  onChange: (next: OwbLocale) => void;
}) {
  const t = useT();
  const next: OwbLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const label = locale === "zh-CN" ? t("locale.switchToEn") : t("locale.switchToZh");
  return (
    <button
      type="button"
      className="owb-wintitle__theme"
      aria-label={label}
      title={label}
      onClick={() => onChange(next)}
    >
      <Languages aria-hidden="true" size={14} strokeWidth={1.8} />
      <span className="owb-wintitle__locale-text">{locale === "zh-CN" ? "EN" : t("locale.switchGlyphZh")}</span>
    </button>
  );
}
