import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";

/**
 * A `fetch` that never answers. The page asks no backend anything, and this stands where the
 * browser's `fetch` would be so that a test can say so.
 */
const unanswered = (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(unanswered));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page at `path`, under the prefix the browser's router gets from `/api/`. */
const renderAt = (path: string) =>
  render(
    <MemoryRouter basename="/api" initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

it("shows the hub at the prefix and at an address it doesn't know", () => {
  for (const path of ["/api/", "/api/anything/else"]) {
    const { unmount } = renderAt(path);
    expect(
      screen.getByRole("heading", { level: 1, name: "Stellar data and payments, as APIs" }),
    ).toBeTruthy();
    unmount();
  }
});

// The design has three navigations (the top bar's, the hero's directory and the footer's), so
// the top bar's is found by its name.
it("has the design's top bar", () => {
  renderAt("/api/");
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const [name, href] of [
    ["Products", "#products"],
    ["Which API?", "#choose"],
    ["How they connect", "#stack"],
    ["FAQ", "#faq"],
    // Not the design's (akot, 2026-11-19): the two pages open to everybody, where a reader on the
    // landing page finds them. The first API's tab, never the bare address (`src/links.ts`).
    ["Quick start", "/api/quick-start/prices"],
    ["Docs", "/api/docs/prices"],
    ["Explorer", "/"],
  ] as const) expect(within(nav).getByRole("link", { name }).getAttribute("href")).toBe(href);
  // "Log in" took its place in the top bar; the hero keeps its own.
  expect(within(nav).queryByRole("link", { name: "Browse APIs" })).toBeNull();
  const [browse, ...more] = screen.getAllByRole("link", { name: "Browse APIs" });
  expect(more).toEqual([]);
  expect(browse?.closest("section")?.getAttribute("aria-labelledby")).toBe("hero-title");
});

/** The top bar's links, in their order. */
const topBarLinks = () =>
  within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");

// "Log in" for everybody (akot, 2026-11-19): a signed-in visitor used to get "Dashboard" here,
// which took asking the hub's backend who is signed in. The sign-in page sends whoever is signed
// in on to the dashboard, so the page asks nothing.
it("offers Log in, last in the top bar, and asks the backend nothing", () => {
  renderAt("/api/");
  const last = topBarLinks().at(-1)!;
  expect(last.textContent).toBe("Log in");
  expect(last.getAttribute("href")).toBe("/api/login");
  expect(last.className).toBe("btn btn-primary");
  expect(topBarLinks().map((a) => a.textContent)).not.toContain("Dashboard");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the hero and its strip in one block, the strip last", () => {
  renderAt("/api/");
  const hero = screen.getByRole("region", { name: "Stellar data and payments, as APIs" });
  const strip = screen.getByRole("region", { name: "Highlights" });
  expect(hero.nextElementSibling).toBe(strip);
  expect(strip.nextElementSibling).toBeNull();
  expect(hero.parentElement).not.toBe(screen.getByRole("main"));
  expect(hero.parentElement?.parentElement).toBe(screen.getByRole("main"));
});

it("lists the three products in the hero's terminal", () => {
  renderAt("/api/");
  expect(screen.getByText("2 APIs live · 1 coming soon")).toBeTruthy();
  for (const [name, href] of [
    ["prices-api/", "/api/prices-api/"],
    ["x402-facilitator/", "/api/x402-facilitator/"],
    ["sorobanscan-api/", "#soroban-scan-api"],
  ] as const) expect(screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href")).toBe(href);
});

it("has a card per product, linked as the design links it", () => {
  renderAt("/api/");
  const products = document.getElementById("products")!;
  expect(within(products).getByRole("heading", { level: 2, name: "Three APIs. One Stellar stack." })).toBeTruthy();
  for (const name of ["Prices API", "x402 Facilitator", "Soroban Scan API"])
    expect(within(products).getByRole("heading", { level: 3, name })).toBeTruthy();
  expect(within(products).getByRole("link", { name: "Explore Prices API" }).getAttribute("href")).toBe("/api/prices-api/");
  expect(within(products).getByRole("link", { name: "Explore x402 Facilitator" }).getAttribute("href")).toBe("/api/x402-facilitator/");
  expect(within(products).getByRole("link", { name: "See what’s coming" }).getAttribute("href")).toBe("#soroban-scan-api");
  for (const text of ["api.sorobanscan.com/prices", "x402-facilitator.sorobanscan.com", "api.sorobanscan.com/scan"])
    expect(within(products).getByText(text)).toBeTruthy();
  expect(products.textContent).not.toContain("api.sorobanscan.com/x402");
});

// What the x402 Facilitator doesn't do yet keeps its place on the card, marked (akot, 2026-11-23):
// production has no ranking, `/discovery/search` or MCP server.
it("marks the x402 card's points that are not live yet", () => {
  renderAt("/api/");
  const card = within(document.getElementById("products")!)
    .getByRole("heading", { level: 3, name: "x402 Facilitator" })
    .closest("article")!;
  const soon = [...card.querySelectorAll(".product-points li")]
    .filter((li) => li.querySelector(".pill-soon")?.textContent === "Soon")
    .map((li) => li.textContent);
  expect(soon).toEqual([
    "→Ranked by volume of successful purchases Soon",
    "→Plain-language search and MCP server for agents Soon",
  ]);
  expect(card.querySelectorAll(".product-points li")).toHaveLength(4);
});

it("sends each use case to its product", () => {
  renderAt("/api/");
  const choose = document.getElementById("choose")!;
  const hrefs = within(choose).getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual([
    "/api/prices-api/", "/api/prices-api/",
    "/api/x402-facilitator/", "/api/x402-facilitator/",
    "#soroban-scan-api",
  ]);
});

it("has every section of the design, in its order", () => {
  renderAt("/api/");
  const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual([
    "Three APIs. One Stellar stack.",
    "Start from what you are building",
    "Read. Pay. Verify.",
    "The explorer’s index, as an API",
    "Infrastructure from the Soroban Scan team",
    "Common questions",
    "Build on Stellar with fewer moving parts",
  ]);
});

it("points every in-page link at something on the page", () => {
  renderAt("/api/");
  const targets = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")!.slice(1));
  expect(targets.length).toBeGreaterThan(0);
  for (const id of targets) expect(document.getElementById(id), `#${id}`).not.toBeNull();
});

it("keeps the design's placeholders", () => {
  renderAt("/api/");
  expect(screen.getByText("[ACCESS MODEL: API key, x402 pay-per-call, or both]")).toBeTruthy();
  expect(document.body.textContent).toContain("[LEDGER]");
  expect(document.body.textContent).toContain("[TX_HASH]");
});

it("says the x402 Facilitator is on testnet today and on mainnet soon", () => {
  renderAt("/api/");
  const answer = within(document.getElementById("faq")!).getByText("Mainnet or testnet?").closest("details")!;
  expect(answer.textContent).toContain("runs on testnet today, where it is free, and on mainnet soon");
});

// Production has no ranking, `/discovery/search` or MCP server yet (2026-11-23): the hub says so.
it("claims no x402 search or ranking as live", () => {
  renderAt("/api/");
  const agents = within(document.getElementById("faq")!).getByText("Can AI agents use these APIs?").closest("details")!;
  expect(agents.textContent).toContain("Agents browse the x402 Bazaar through /discovery/resources");
  expect(agents.textContent).toContain("are coming soon");
  expect(document.getElementById("stack")!.textContent).toContain("lists your API in the Bazaar, and soon ranks it higher");
});

it("answers the four questions", () => {
  renderAt("/api/");
  const faq = document.getElementById("faq")!;
  for (const q of [
    "Do I need a separate key for each API?", "Can I use the APIs together?",
    "Mainnet or testnet?", "Can AI agents use these APIs?",
  ]) expect(within(faq).getByText(q).closest("details")).not.toBeNull();
});

it("links out safely and to no host but GitHub", () => {
  renderAt("/api/");
  for (const a of document.querySelectorAll("a")) {
    const href = a.getAttribute("href")!;
    if (/^(https?:)?\/\//.test(href)) expect(href).toBe("https://github.com/rumblefishdev/stellar-x402");
    if (a.getAttribute("target") === "_blank") expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

// The curl preview scrolls sideways inside itself on a phone, so it takes the keyboard's focus:
// a focusable region named by its bar, the name a screen reader gives it when it lands there.
it("names the curl preview by its bar", () => {
  renderAt("/api/");
  const preview = screen.getByRole("region", { name: "soroban-scan-api" });
  expect(preview.tagName).toBe("PRE");
  expect(preview.getAttribute("tabindex")).toBe("0");
  expect(preview.textContent).toContain("curl api.sorobanscan.com/scan/contracts/");
});

it("has the design's footer", () => {
  renderAt("/api/");
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByText("Soroban Scan APIs by Rumble Fish")).toBeTruthy();
  for (const name of ["Soroban Scan", "Prices API", "x402 Facilitator", "GitHub"])
    expect(within(footer).getByRole("link", { name })).toBeTruthy();
});

// A browser jumps to an address's `#part` only if the part exists when the page loads, and this
// page draws its parts after that: `/api/#products`, opened from another page or pasted, stayed at
// the top (akot, 2026-11-19).
it("scrolls to the part its address names when it opens", () => {
  const scrolled: string[] = [];
  const prototype = Element.prototype as { scrollIntoView?: () => void };
  prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  try {
    renderAt("/api/#products").unmount();
    expect(scrolled).toEqual(["products"]);
    // No part named, a part the page doesn't have, a malformed escape: nothing moves, nothing breaks.
    for (const path of ["/api/", "/api/#nothing-here", "/api/#%E0%A4%A"]) renderAt(path).unmount();
    expect(scrolled).toEqual(["products"]);
  } finally {
    delete prototype.scrollIntoView;
  }
});

// The x402 Facilitator's page is back, a tree of this bundle (`src/x402/`): every x402 link on the
// hub goes to it, as every Prices link goes to the Prices portal's.
it("sends every x402 link to the x402 Facilitator's page", () => {
  renderAt("/api/");
  const x402 = screen.getAllByRole("link", { name: /x402/i }).filter((a) => !a.getAttribute("href")?.startsWith("#"));
  // The hero's row, the card's button, the two use cases, the closing button and the footer's.
  expect(x402.length).toBe(6);
  for (const a of x402) expect(a.getAttribute("href"), a.textContent ?? "").toBe("/api/x402-facilitator/");
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByRole("link", { name: "x402 Facilitator" }).getAttribute("href")).toBe("/api/x402-facilitator/");
  const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
  expect(hrefs.filter((h) => h.includes("quick-start/x402"))).toEqual([]);
});
