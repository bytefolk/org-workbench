import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle, useThemeMode } from "../src/theme-toggle";
import { THEME_STORAGE_KEY } from "../src/theme-mode";

/** #94: the title-bar entry point. The button is the only writer of
 * `data-theme`; `useThemeMode()` is the reader that carries the switch into
 * antd's cssinjs algorithm, so both halves are exercised together here. */
function TitleBarToggle() {
  const mode = useThemeMode();
  return (
    <>
      <ThemeToggle mode={mode} />
      <span data-testid="observed-mode">{mode}</span>
    </>
  );
}

/** The click writes `data-theme` synchronously, but the reader is a
 * MutationObserver, so its state update lands a microtask later — flush it
 * inside act() so the assertions see the settled tree. */
async function clickToggle(name: string): Promise<void> {
  const button = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute("data-theme", "light");
});

describe("theme toggle entry point (#94)", () => {
  it("flips <html data-theme> and persists the choice", async () => {
    render(<TitleBarToggle />);

    await clickToggle("切换到深色主题");

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await clickToggle("切换到浅色主题");

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  // The failure mode useThemeMode's comment warns about: the shell goes dark
  // while every antd control stays light. The observer has to see the write.
  it("propagates the write back to the reader that drives antd's algorithm", async () => {
    render(<TitleBarToggle />);
    expect(screen.getByTestId("observed-mode")).toHaveTextContent("light");

    await clickToggle("切换到深色主题");

    expect(screen.getByTestId("observed-mode")).toHaveTextContent("dark");
  });

  it("reports its toggle state and its target to assistive tech", async () => {
    render(<TitleBarToggle />);

    const light = screen.getByRole("button", { name: "切换到深色主题" });
    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(light).toHaveAttribute("title", "切换到深色主题");

    await clickToggle("切换到深色主题");

    const dark = screen.getByRole("button", { name: "切换到浅色主题" });
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("title", "切换到浅色主题");
  });

  // Not decoration: the title bar is a -webkit-app-region: drag surface, so a
  // control inside it is unclickable unless it opts out.
  it("opts out of the title bar drag region", () => {
    render(<TitleBarToggle />);

    expect(screen.getByRole("button", { name: "切换到深色主题" })).toHaveClass("owb-wintitle__theme");
  });

  it("adopts a dark theme that was already seeded before mount", () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<TitleBarToggle />);

    expect(screen.getByTestId("observed-mode")).toHaveTextContent("dark");
    expect(screen.getByRole("button", { name: "切换到浅色主题" })).toHaveAttribute("aria-pressed", "true");
  });
});
