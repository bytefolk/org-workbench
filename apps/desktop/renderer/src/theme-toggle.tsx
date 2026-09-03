import { useEffect, useState } from "react";
import type { ThemeMode } from "./theme-mode";

export type { ThemeMode };

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
