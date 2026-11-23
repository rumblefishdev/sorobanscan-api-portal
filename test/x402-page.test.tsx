import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/x402/App";

/** The one host the page links to besides sorobanscan.com: the repository's. */
const GITHUB_URL = "https://github.com/rumblefishdev/stellar-x402";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  window.history.pushState(null, "", "/");
  document.head.querySelectorAll("title").forEach((title) => title.remove());
});

const at = (path = "/api/x402-facilitator/") => {
  window.history.pushState(null, "", path);
  return render(<App />);
};
const headings = () => screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent);

it("has one top heading on the landing page, its promise", () => {
  at();
  expect(headings()).toEqual(["Get your API found by AI agents"]);
});

it("names the page in the document's title, in place of the hub's", () => {
  // As the shared `index.html` has it: the hub's title, which the page's must replace.
  const hubTitle = document.createElement("title");
  hubTitle.textContent = "Soroban Scan APIs";
  document.head.appendChild(hubTitle);
  at();
  expect(document.title).toBe("x402 Facilitator for Stellar");
});

it("points every in-page link at a part of the page", () => {
  const { container } = at();
  const targets = [...container.querySelectorAll('a[href^="#"]')].map((a) =>
    a.getAttribute("href")!.slice(1),
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const id of new Set(targets)) expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
});

it("names every section with a heading that exists", () => {
  const { container } = at();
  for (const section of container.querySelectorAll("section[aria-labelledby]")) {
    const id = section.getAttribute("aria-labelledby")!;
    expect(section.querySelector(`[id="${id}"]`)).not.toBeNull();
  }
});

it("puts an example in the search box when it is picked", () => {
  at();
  fireEvent.click(screen.getByRole("button", { name: "Weather forecast" }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Weather forecast");
});

it("sends every Get API Key to the hub's sign-in, in the same tab", () => {
  at();
  const links = screen.getAllByRole("link", { name: "Get API Key" });
  expect(links.length).toBeGreaterThan(1);
  for (const link of links) {
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/api/login?from=x402");
    expect(link.getAttribute("target")).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
});

// The top bar's button says what it does (akot, 2026-11-19): it opens the hub's sign-in, where the
// key is one press further on. The page's own "Get API Key" buttons keep their words.
it("offers Log in in the top bar, to the hub's sign-in", () => {
  at();
  const bar = within(screen.getByRole("navigation", { name: "Main" }));
  const logIn = bar.getByRole("link", { name: "Log in" });
  expect(logIn.getAttribute("href")).toBe("/api/login?from=x402");
  expect(logIn.getAttribute("target")).toBeNull();
  expect(logIn.className).toBe("btn btn-primary");
  expect(bar.queryByRole("link", { name: "Get API Key" })).toBeNull();
});

// As the Prices API portal draws its own two (akot, 2026-11-19): the arrow in a disc after the
// words, which a screen reader doesn't read.
it("draws Get API Key and View documentation with the arrow of the Prices API portal's", () => {
  at();
  const calls = [
    ...screen.getAllByRole("link", { name: "Get API Key" }),
    ...screen.getAllByRole("link", { name: "View documentation" }),
  ];
  expect(screen.getAllByRole("link", { name: "View documentation" }).length).toBeGreaterThan(0);
  for (const call of calls) {
    const badge = call.querySelector(".arrow-badge");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(call.classList.contains("btn-arrow")).toBe(true);
  }
});

it("names no route of this page in the key card", () => {
  const { container } = at();
  const card = container.querySelector(".key-card");
  expect(card).not.toBeNull();
  expect(card!.querySelector("a")).toBeNull();
  expect(card!.innerHTML).not.toMatch(/\/login|\/dashboard/);
});

it.each(["/api/x402-facilitator", "/api/x402-facilitator/login", "/api/x402-facilitator/anything"])(
  "shows the landing page at %s",
  (path) => {
    at(path);
    expect(headings()).toEqual(["Get your API found by AI agents"]);
  },
);

it("has the footer's way back to the explorer, the Prices API and the hub", () => {
  at();
  const footer = within(screen.getByRole("navigation", { name: "Footer" }));
  for (const [name, href] of [
    ["Soroban Scan", "/"],
    ["Prices API", "/api/prices-api/"],
    ["All APIs", "/api/"],
    ["GitHub", GITHUB_URL],
  ] as const) expect(footer.getByRole("link", { name }).getAttribute("href")).toBe(href);
});

// A build for another prefix is the whole app there (`VITE_BASE_PATH`): a link that stayed under
// `/api/` would take the visitor out of it, to whatever production serves at that address.
describe.each(["/api/", "/api/next/"])("the page in a bundle built for %s", (base) => {
  /** The page as that bundle has it: `src/links.ts` reads the prefix when it loads. */
  const renderFor = async () => {
    vi.stubEnv("BASE_URL", base);
    vi.resetModules();
    const { App: Page } = await import("../src/x402/App");
    window.history.pushState(null, "", `${base}x402-facilitator/`);
    return render(<Page />);
  };

  it("links only under the prefix, to the explorer, to GitHub or within itself", async () => {
    const { container } = await renderFor();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href.startsWith("#") || href === "/" || href === GITHUB_URL) continue;
      expect(href.startsWith(base), href).toBe(true);
    }
  });

  it("sends the sign-in, the Prices API and All APIs to the bundle's own pages", async () => {
    await renderFor();
    for (const link of screen.getAllByRole("link", { name: "Get API Key" }))
      expect(link.getAttribute("href")).toBe(`${base}login?from=x402`);
    const footer = within(screen.getByRole("navigation", { name: "Footer" }));
    expect(footer.getByRole("link", { name: "Prices API" }).getAttribute("href")).toBe(
      `${base}prices-api/`,
    );
    expect(footer.getByRole("link", { name: "All APIs" }).getAttribute("href")).toBe(base);
  });
});
