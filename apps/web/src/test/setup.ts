import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { activeApis } from "./api";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * Network guard (T096): no test may reach a real server. Every fetch or XHR that a
 * test did not mock is recorded and fails the test in `afterEach`, even when the
 * page under test swallowed the rejection and rendered an error state.
 */
export const unmockedRequests: string[] = [];

const guardFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  unmockedRequests.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
  return Promise.reject(new Error(`Unmocked network request: ${url}. Install a fetch mock (src/test/api.ts).`));
};

class GuardXMLHttpRequest {
  open(method: string, url: string) {
    unmockedRequests.push(`${method.toUpperCase()} ${url} (XHR)`);
    throw new Error(`Unmocked XMLHttpRequest: ${url}`);
  }
}

// jsdom gaps that antd relies on.
const installDomPolyfills = () => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", { writable: true, configurable: true, value: ResizeObserverStub });
    Object.defineProperty(globalThis, "ResizeObserver", { writable: true, configurable: true, value: ResizeObserverStub });
  }
  // jsdom does not implement pseudo-element styles and logs "Not implemented" for them.
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => originalGetComputedStyle(element);
  window.scrollTo = () => undefined;
  Element.prototype.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
};

installDomPolyfills();

beforeEach(() => {
  unmockedRequests.length = 0;
  activeApis.length = 0;
  vi.stubGlobal("fetch", vi.fn(guardFetch));
  vi.stubGlobal("XMLHttpRequest", GuardXMLHttpRequest);
  try {
    window.localStorage.clear();
  } catch {
    // Storage can be unavailable; the stores fall back to their defaults.
  }
  window.history.replaceState({}, "", "/");
  // Module singletons carry state between tests unless reset.
  useAuthStore.setState({ isAuthed: false, isLoading: true, user: null });
  useThemeStore.setState({ theme: "light" });
  useUiStore.setState(useUiStore.getInitialState(), true);
});

/** Throws if any fake API created by the running test answered a request no route handles. */
export function assertAllMocksHandled() {
  const unhandled = activeApis.flatMap((api) => api.unhandled);
  if (unhandled.length) {
    throw new Error(`Requests without a mocked route:\n${unhandled.join("\n")}`);
  }
}

afterEach(() => {
  cleanup();
  const leaked = unmockedRequests.splice(0);
  if (leaked.length) {
    throw new Error(`Test attempted real network requests:\n${leaked.join("\n")}`);
  }
  assertAllMocksHandled();
});
