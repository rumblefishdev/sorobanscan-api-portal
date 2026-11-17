import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * The only test of `main.tsx`, and the one that fails if the router loses its `basename`: the
 * entry point mounted at the address the bundle serves, as `src/boot.js` imports it there.
 * `App.spec.tsx` gives its own `MemoryRouter` the prefix, so it can't see that.
 */
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ authenticated: false })),
  );
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  // Only what the pages hoist: emotion keeps its `<style>` tags in the head across tests.
  document.head
    .querySelectorAll('title, meta[name="robots"]')
    .forEach((element) => element.remove());
  window.history.pushState({}, "", "/");
});

it("mounts the sign-in page at /api/login", async () => {
  window.history.pushState({}, "", "/api/login");
  await act(async () => {
    await import("./main");
  });
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(window.location.pathname).toBe("/api/login");
});

it("sends a signed-out visitor from /api/dashboard to /api/login, and names the page", async () => {
  // As the shared `index.html` has it: the hub's title, which the page's must replace.
  const hubTitle = document.createElement("title");
  hubTitle.textContent = "Soroban Scan APIs";
  document.head.appendChild(hubTitle);

  window.history.pushState({}, "", "/api/dashboard");
  await act(async () => {
    await import("./main");
  });
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  expect(window.location.pathname).toBe("/api/login");
  expect(document.title).toBe("Soroban Scan APIs — Sign in");
  expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
    "noindex",
  );
});
