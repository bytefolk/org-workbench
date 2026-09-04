import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PrefsMenu } from "../src/prefs-menu";
import { useThemeMode } from "../src/theme-toggle";
import { THEME_STORAGE_KEY } from "../src/theme-mode";

/** #94 / 偏好抽屉：主题入口收进右上角抽屉后，主题行仍是 `data-theme` 的
 * 唯一写者；`useThemeMode()` 是驱动 antd cssinjs 算法的读侧，两半一起验。 */
function PrefsThemeHarness() {
  const mode = useThemeMode();
  return (
    <>
      <PrefsMenu locale="zh-CN" onChangeLocale={() => undefined} mode={mode} />
      <span data-testid="observed-mode">{mode}</span>
    </>
  );
}

/** The click writes `data-theme` synchronously, but the reader is a
 * MutationObserver, so its state update lands a microtask later — flush it
 * inside act() so the assertions see the settled tree. */
async function openPrefs(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "偏好设置" }));
  });
}

async function clickThemeRow(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: /主题/ }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute("data-theme", "light");
});

describe("prefs drawer theme entry (#94)", () => {
  it("flips <html data-theme> and persists the choice", async () => {
    render(<PrefsThemeHarness />);
    await openPrefs();

    await clickThemeRow();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await clickThemeRow();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  // The failure mode useThemeMode's comment warns about: the shell goes dark
  // while every antd control stays light. The observer has to see the write.
  it("propagates the write back to the reader that drives antd's algorithm", async () => {
    render(<PrefsThemeHarness />);
    await openPrefs();
    expect(screen.getByTestId("observed-mode")).toHaveTextContent("light");

    await clickThemeRow();

    expect(screen.getByTestId("observed-mode")).toHaveTextContent("dark");
  });

  it("reports its toggle state and its current value to assistive tech", async () => {
    render(<PrefsThemeHarness />);
    await openPrefs();

    const light = screen.getByRole("menuitem", { name: /主题/ });
    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(light.textContent).toContain("浅色");

    await clickThemeRow();

    const dark = screen.getByRole("menuitem", { name: /主题/ });
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(dark.textContent).toContain("深色");
  });

  // Not decoration: the title bar is a -webkit-app-region: drag surface, so a
  // control inside it is unclickable unless it opts out.
  it("trigger opts out of the title bar drag region", () => {
    render(<PrefsThemeHarness />);

    expect(screen.getByRole("button", { name: "偏好设置" })).toHaveClass("owb-wintitle__theme");
  });

  it("adopts a dark theme that was already seeded before mount", async () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<PrefsThemeHarness />);
    await openPrefs();

    expect(screen.getByTestId("observed-mode")).toHaveTextContent("dark");
    expect(screen.getByRole("menuitem", { name: /主题/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("closes on escape and on outside pointerdown", async () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <PrefsThemeHarness />
      </div>,
    );
    await openPrefs();
    expect(screen.getByRole("menu", { name: "偏好设置" })).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("menu", { name: "偏好设置" })).toBeNull();

    await openPrefs();
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId("outside"));
    });
    expect(screen.queryByRole("menu", { name: "偏好设置" })).toBeNull();
  });
});
