import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setThemeMode, type ThemeMode } from "./theme-mode";

/** Live `data-theme` on <html> (main.tsx seeds it, see initThemeMode). antd's
 * cssinjs algorithm has to follow the same switch as the --ui-* skin, otherwise
 * the shell goes dark while every antd control stays light (spec §5 双主题验收). */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const target = document.documentElement;
    const sync = (): void =>
      setMode(target.getAttribute("data-theme") === "dark" ? "dark" : "light");
    const observer = new MutationObserver(sync);
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** The theme entry point (#94): the only writer of `data-theme`, driving the
 * dark palette that antd-skin.css has shipped complete but unreachable since
 * #73. Unlike `.owb-wctl`, the icon stays visible instead of appearing on
 * title-bar hover — here the icon *is* the state readout, so hiding it would
 * hide the very thing the control reports. */
export function ThemeToggle({ mode }: { mode: ThemeMode }) {
  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  const label = next === "dark" ? "切换到深色主题" : "切换到浅色主题";
  return (
    <button
      type="button"
      className="owb-wintitle__theme"
      aria-label={label}
      aria-pressed={mode === "dark"}
      title={label}
      onClick={() => setThemeMode(next)}
    >
      {mode === "dark"
        ? <Sun aria-hidden="true" size={14} strokeWidth={1.8} />
        : <Moon aria-hidden="true" size={14} strokeWidth={1.8} />}
    </button>
  );
}
