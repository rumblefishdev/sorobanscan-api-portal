import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";

/**
 * A `fetch` that never answers, as a backend slow to: the top bar asks the hub's backend who is
 * signed in, and a test that isn't about that leaves the question open. It gives up only when the
 * page does, as a real one does on an abort.
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

/** A `/me` answer: a string body as an HTML page, anything else as JSON. */
const answer = (status: number, body: unknown) =>
  typeof body === "string"
    ? new Response(body, { status, headers: { "content-type": "text/html" } })
    : Response.json(body, { status });

/** Lets the page take in an answer `fetch` already has: every promise chained on it settles. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

it("asks the hub's backend once who is signed in, with the page's own cookies", () => {
  renderAt("/api/");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "/api/hub/me",
    expect.objectContaining({ credentials: "same-origin", headers: { accept: "application/json" } }),
  );
});

it("offers Log in, last in the top bar, while it asks", () => {
  renderAt("/api/");
  const last = topBarLinks().at(-1)!;
  expect(last.textContent).toBe("Log in");
  expect(last.getAttribute("href")).toBe("/api/login");
  expect(last.className).toBe("btn btn-primary");
});

it.each([
  ["says nobody is", () => answer(200, { authenticated: false })],
  ["isn't set up for sign-in", () => answer(503, { error: "sign_in_not_configured" })],
  ["fails, whatever its body says", () => answer(500, { authenticated: true })],
  ["answers with a page, not JSON", () => answer(200, "<!doctype html><title>Soroban Scan</title>")],
  ["says it in another form", () => answer(200, { authenticated: "true" })],
  ["can't be reached", () => Promise.reject(new TypeError("fetch failed"))],
])("offers Log in when the backend %s", async (_, respond) => {
  vi.mocked(fetch).mockImplementation(async () => respond());
  renderAt("/api/");
  await settle();
  const last = topBarLinks().at(-1)!;
  expect(last.textContent).toBe("Log in");
  expect(last.getAttribute("href")).toBe("/api/login");
  expect(topBarLinks().map((a) => a.textContent)).not.toContain("Dashboard");
});

it("offers Dashboard in its place to whoever is signed in", async () => {
  vi.mocked(fetch).mockImplementation(async () =>
    answer(200, { authenticated: true, id: "80351110224678912", username: "nelly" }),
  );
  renderAt("/api/");
  const nav = screen.getByRole("navigation", { name: "Main" });
  const dashboard = await within(nav).findByRole("link", { name: "Dashboard" });
  expect(dashboard.getAttribute("href")).toBe("/api/dashboard");
  // The same button as "Log in", so the bar doesn't move when one turns into the other.
  expect(dashboard.className).toBe("btn btn-primary");
  expect(topBarLinks().at(-1)).toBe(dashboard);
  expect(within(nav).queryByRole("link", { name: "Log in" })).toBeNull();
  // The answer re-renders the bar, which doesn't ask again.
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("stops asking when the page goes", () => {
  const { unmount } = renderAt("/api/");
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

// The stylesheet sizes the hero and its strip together to the first screen, the strip at the
// bottom: that holds only while the two are one block in <main>, the strip its last part.
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
