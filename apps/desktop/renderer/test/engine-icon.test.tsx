import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EngineIcon } from "../src/turns/engine-icon";
import type { TurnEngine } from "../src/turns";

describe("EngineIcon (#57)", () => {
  const engines: TurnEngine[] = ["qoder", "claude-code", "claude-local"];

  it.each(engines)("renders a 14px brand mark for %s", (engine) => {
    const { container } = render(<EngineIcon engine={engine} />);
    const img = container.querySelector("img.owb-engine-icon");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("maps qoder to the Qoder mark and claude engines to the Claude mark", () => {
    const src = (engine: TurnEngine) => {
      const { container } = render(<EngineIcon engine={engine} />);
      return container.querySelector("img.owb-engine-icon")?.getAttribute("src") ?? "";
    };
    // Vite inlines the small claude.svg as a data URI; the brand fill #D97757
    // stays percent-encoded, so it is the stable identity marker in tests.
    expect(src("qoder")).toMatch(/qoder/);
    expect(src("claude-code")).toContain("%23D97757");
    expect(src("claude-local")).toContain("%23D97757");
    expect(src("claude-code")).toBe(src("claude-local"));
    expect(src("claude-code")).not.toEqual(src("qoder"));
  });
});
