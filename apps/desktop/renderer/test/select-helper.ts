import { fireEvent, screen } from "@testing-library/react";

/** Options of the currently open antd dropdown. Closed dropdowns linger in
 * the DOM (close animation pending in jsdom), so pick the last non-hidden
 * dropdown — the most recently opened one (#57). */
export function visibleSelectOptions(): HTMLElement[] {
  const dropdowns = document.querySelectorAll<HTMLElement>(".ant-select-dropdown");
  const visible = Array.from(dropdowns).filter(
    (dropdown) => !dropdown.classList.contains("ant-select-dropdown-hidden"),
  );
  const latest = visible[visible.length - 1] ?? document;
  return Array.from(latest.querySelectorAll<HTMLElement>(".ant-select-item-option"));
}

/** Drive an antd Select in tests (#57): open the dropdown with mousedown,
 * then click the option whose rendered text contains `optionText`. */
export function pickSelectOption(comboboxName: string, optionText: string): void {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: comboboxName }));
  const target = visibleSelectOptions().find((option) => option.textContent?.includes(optionText));
  if (target === undefined) {
    throw new Error(`select "${comboboxName}" has no option containing "${optionText}"`);
  }
  fireEvent.click(target);
}
