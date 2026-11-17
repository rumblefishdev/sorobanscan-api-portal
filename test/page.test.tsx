import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(cleanup);

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
    ["Explorer", "/"],
  ] as const) expect(within(nav).getByRole("link", { name }).getAttribute("href")).toBe(href);
  expect(within(nav).queryByRole("link", { name: /log ?in|sign ?in|dashboard/i })).toBeNull();
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
  for (const text of ["api.sorobanscan.com/prices", "api.sorobanscan.com/x402", "api.sorobanscan.com/scan"])
    expect(within(products).getByText(text)).toBeTruthy();
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
    if (/^https?:/.test(href)) expect(href).toBe("https://github.com/rumblefishdev/stellar-x402");
    if (a.getAttribute("target") === "_blank") expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

it("has the design's footer", () => {
  renderAt("/api/");
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByText("Soroban Scan APIs by Rumble Fish")).toBeTruthy();
  for (const name of ["Soroban Scan", "Prices API", "x402 Facilitator", "GitHub"])
    expect(within(footer).getByRole("link", { name })).toBeTruthy();
});
