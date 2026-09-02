import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// antd components observe resize/matchMedia; jsdom provides neither.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.matchMedia ??= vi.fn().mockReturnValue({
  matches: false,
  media: "",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}) as unknown as typeof matchMedia;

// This jsdom build does not expose window.localStorage under the test origin;
// the theme/locale persistence tests need a real Storage surface. Install one
// only when absent, backed by Storage.prototype (a shared map) so that tests
// spying Storage.prototype — e.g. theme-mode's "storage unavailable" case —
// behave exactly as they would against jsdom's native Storage. Production code
// already guards storage access with try/catch, so this never papers over a
// real bug.
if (typeof window !== "undefined" && window.localStorage === undefined && typeof Storage !== "undefined") {
  const backing = new Map<string, string>();
  Object.defineProperties(Storage.prototype, {
    getItem: {
      configurable: true,
      writable: true,
      value: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    },
    setItem: {
      configurable: true,
      writable: true,
      value: (key: string, value: string) => void backing.set(key, String(value)),
    },
    removeItem: {
      configurable: true,
      writable: true,
      value: (key: string) => void backing.delete(key),
    },
    clear: {
      configurable: true,
      writable: true,
      value: () => void backing.clear(),
    },
    key: {
      configurable: true,
      writable: true,
      value: (index: number) => [...backing.keys()][index] ?? null,
    },
    length: {
      configurable: true,
      get() {
        return backing.size;
      },
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: Object.create(Storage.prototype) as Storage,
  });
}

afterEach(() => {
  cleanup();
});
