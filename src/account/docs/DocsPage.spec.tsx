import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE } from "../../prices/docs/openapi.fixture";
import {
  OPENAPI_JSON,
  OPENAPI_JSON_DOWNLOAD,
  OPENAPI_JSON_FILENAME,
} from "../../prices/landing/links";
import { App } from "../App";
import { DOCUMENTED_PATHS } from "./X402QuickStart";

/**
 * `/quick-start/<api>` and `/docs/<api>` (`DocsPage.tsx`): every API's quick start and API
 * reference, pages of the account tree since 2026-11-19 and open to everybody. Until then they
 * were the Prices portal's own, at `/api/prices-api/quick-start` and `/api/prices-api/docs`; what
 * its spec (`src/prices/app/app.spec.tsx`) held about them as pages is held here, and what it
 * holds now is that those two addresses send the browser to these.
 *
 * Through the account `App`, as `src/account/App.spec.tsx` mounts it, so the addresses, the one
 * `/me` and the forwards are the ones a visitor gets.
 */

/** Where the router is now, under its basename: `MemoryRouter` has no `window.location`. */
let where = "";
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

/** The pages at `path`, under the prefix the browser's router gets from `/api/`. */
const renderAt = (path: string) =>
  render(
    <MemoryRouter basename="/api" initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );

const answer = (status: number, body: unknown) => Response.json(body, { status });
const SIGNED_IN = { authenticated: true, id: "80351110224678912", username: "nelly" };
const SIGNED_OUT = { authenticated: false };

/** A `fetch` that never answers, as a slow backend, until the page gives up. */
const unanswered = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/**
 * x402's OpenAPI document as the page ships it: the file itself, so a reference that renders in
 * these tests is the one a reader gets.
 */
const X402_DOCUMENT_URL = "/api/docs/x402/openapi.json";
const X402_DOCUMENT = JSON.parse(
  // From the repo's root, where Vitest runs, as the Prices specs read their files.
  readFileSync(join(process.cwd(), "public/docs/x402/openapi.json"), "utf8"),
) as { paths: Record<string, Record<string, unknown>> };

/**
 * The backends these pages reach: the hub's `/me` answered by `me` and its sign-out by `logout`,
 * Prices' OpenAPI document where its API serves it, and x402's from the bundle. Anything else is
 * a request the pages shouldn't make.
 */
function stubBackend(
  me: (init?: RequestInit) => Response | Promise<Response>,
  logout: () => Response | Promise<Response> = () => new Response(null, { status: 204 }),
) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (url === "/api/hub/me" && (init?.method ?? "GET") === "GET") return me(init);
    if (url === "/api/hub/auth/logout" && init?.method === "POST") return logout();
    if (url === OPENAPI_JSON) return answer(200, FIXTURE);
    if (url === X402_DOCUMENT_URL) return answer(200, X402_DOCUMENT);
    throw new Error(`unexpected request to ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Lets the page take in an answer `fetch` already has: every promise chained on it settles. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** How often the pages asked `url`. */
const asked = (fetchMock: ReturnType<typeof stubBackend>, url: string) =>
  fetchMock.mock.calls.filter(([called]) => called === url).length;

const PRICES_GUIDE = /get your first response in under 5 minutes/i;
const X402_GUIDE = "Take x402 payments on Stellar";
/** The two kinds of page, with the bar's link that is underlined on each. */
const KINDS = [
  ["quick-start", "Quick start"],
  ["docs", "OpenAPI Docs"],
] as const;

/** Each page's own first heading, drawn once its chunk, and a reference's document, are in. */
const pageHeading = (kind: string, api: string) =>
  kind === "docs"
    ? screen.findByRole("heading", { level: 1, name: "API reference" })
    : screen.findByRole("heading", {
        level: 1,
        name: api === "x402" ? X402_GUIDE : PRICES_GUIDE,
      });

const withX402 = () => vi.stubEnv("VITE_PRODUCTS", "prices,x402");

/**
 * The page under the API tabs: the selected tab's panel. By the tab's `aria-controls`, since a
 * guide has tab panels of its own (a snippet in each language).
 */
function pagePanel(): HTMLElement {
  const tabs = within(screen.getByRole("tablist", { name: "APIs" }));
  const id = tabs.getByRole("tab", { selected: true }).getAttribute("aria-controls");
  const panel = id === null ? null : document.getElementById(id);
  if (panel === null) throw new Error("the selected API tab controls no panel");
  return panel;
}

beforeEach(() => {
  where = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the address", () => {
  // The Prices pages handed out the bare addresses with a part: `…/quick-start#examples` from
  // the landing's documentation cards.
  it.each([
    ["/api/quick-start", "/quick-start/prices"],
    ["/api/docs", "/docs/prices"],
    ["/api/quick-start#examples", "/quick-start/prices#examples"],
    ["/api/docs#op-get-v1-assets", "/docs/prices#op-get-v1-assets"],
  ])("%s goes to the first open API's tab, keeping its part", async (path, tab) => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(path);
    await waitFor(() => expect(where).toBe(tab));
    expect(screen.getByRole("tab", { name: "Prices API" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it.each([
    ["an API the build leaves shut", "/api/docs/x402", "/docs/prices"],
    ["an API the build leaves shut, with a part", "/api/quick-start/x402#bazaar", "/quick-start/prices#bazaar"],
    ["an API nobody has", "/api/docs/nope", "/docs/prices"],
    ["an API nobody has", "/api/quick-start/prices-api", "/quick-start/prices"],
  ])("replaces an address that names %s by the first open tab's", async (_what, path, tab) => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(path);
    await waitFor(() => expect(where).toBe(tab));
    await pageHeading(tab.startsWith("/docs") ? "docs" : "quick-start", "prices");
  });

  it.each(KINDS)("keeps /%s/x402 once the build opens x402", async (kind) => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(`/api/${kind}/x402`);
    await pageHeading(kind, "x402");
    expect(where).toBe(`/${kind}/x402`);
    expect(screen.getByRole("tab", { name: "x402" }).getAttribute("aria-selected")).toBe("true");
  });

  it("leaves a build that opens no API to the dashboard, which sends a stranger to the sign-in", async () => {
    vi.stubEnv("VITE_PRODUCTS", "nope");
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs");
    await waitFor(() => expect(where).toBe("/login"));
  });
});

describe("the bar", () => {
  it.each(KINDS)(
    "offers a visitor who isn't signed in the two pages and Log in, on /%s",
    async (kind, current) => {
      stubBackend(() => answer(200, SIGNED_OUT));
      renderAt(`/api/${kind}/prices`);
      const bar = within(await screen.findByRole("navigation", { name: "Documentation" }));
      const login = await bar.findByRole("link", { name: "Log in" });
      // The sign-in comes back to this API's tab of the dashboard.
      expect(login.getAttribute("href")).toBe("/api/login?from=prices");
      expect(bar.getByRole("link", { name: "Quick start" }).getAttribute("href")).toBe(
        "/api/quick-start/prices",
      );
      expect(bar.getByRole("link", { name: "OpenAPI Docs" }).getAttribute("href")).toBe(
        "/api/docs/prices",
      );
      for (const name of ["Quick start", "OpenAPI Docs"]) {
        expect(bar.getByRole("link", { name }).getAttribute("aria-current"), name).toBe(
          name === current ? "page" : null,
        );
      }
      // Nothing that needs a session.
      expect(bar.queryByRole("link", { name: "Dashboard" })).toBeNull();
      expect(bar.queryByRole("button", { name: "Sign out" })).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Dashboard" })).toBeNull();
      // The logo is the way to the rest of the explorer, as on every bar.
      expect(bar.getByRole("link", { name: "SorobanScan" }).getAttribute("href")).toBe(
        "https://sorobanscan.com/",
      );
    },
  );

  it("keeps its links and Log in to the API the page is about", async () => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/x402");
    const bar = within(await screen.findByRole("navigation", { name: "Documentation" }));
    expect((await bar.findByRole("link", { name: "Log in" })).getAttribute("href")).toBe(
      "/api/login?from=x402",
    );
    expect(bar.getByRole("link", { name: "Quick start" }).getAttribute("href")).toBe(
      "/api/quick-start/x402",
    );
    expect(bar.getByRole("link", { name: "OpenAPI Docs" }).getAttribute("href")).toBe(
      "/api/docs/x402",
    );
  });

  it("draws the page at once, and neither Log in nor Dashboard while the backend hasn't said", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => unanswered(init)),
    );
    renderAt("/api/quick-start/prices");
    // The page itself doesn't wait for the session.
    expect(screen.getByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeTruthy();
    const bar = within(screen.getByRole("navigation", { name: "Documentation" }));
    expect(bar.getByRole("link", { name: "Quick start" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "OpenAPI Docs" })).toBeTruthy();
    // Neither, for a visitor who may be either.
    expect(bar.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(bar.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  // Not knowing who is signed in holds the dashboard back; it doesn't hold these pages back.
  it.each([
    ["has no sign-in configured", () => answer(503, { error: "sign_in_not_configured" })],
    ["fails", () => answer(500, {})],
    ["can't be reached", () => Promise.reject(new TypeError("fetch failed"))],
    ["answers what isn't JSON", () => new Response("<!doctype html>", { status: 200 })],
  ])("still shows the page, with Log in, when the backend %s", async (_what, me) => {
    stubBackend(me);
    renderAt("/api/quick-start/prices");
    const bar = within(screen.getByRole("navigation", { name: "Documentation" }));
    expect((await bar.findByRole("link", { name: "Log in" })).getAttribute("href")).toBe(
      "/api/login?from=prices",
    );
    expect(screen.getByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeTruthy();
    expect(screen.queryByTestId("session-check-failed")).toBeNull();
    expect(where).toBe("/quick-start/prices");
  });

  it.each(KINDS)(
    "is the dashboard's for whoever is signed in, on /%s",
    async (kind, current) => {
      stubBackend(() => answer(200, SIGNED_IN));
      renderAt(`/api/${kind}/prices`);
      const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
      expect(bar.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe(
        "/api/dashboard/prices",
      );
      expect(bar.getByRole("link", { name: "Quick start" }).getAttribute("href")).toBe(
        "/api/quick-start/prices",
      );
      expect(bar.getByRole("link", { name: "OpenAPI Docs" }).getAttribute("href")).toBe(
        "/api/docs/prices",
      );
      // This page underlined, not the dashboard.
      for (const name of ["Dashboard", "Quick start", "OpenAPI Docs"]) {
        expect(bar.getByRole("link", { name }).getAttribute("aria-current"), name).toBe(
          name === current ? "page" : null,
        );
      }
      expect(bar.getByText("nelly")).toBeTruthy();
      expect(bar.getByRole("button", { name: "Sign out" })).toBeTruthy();
      expect(bar.queryByRole("link", { name: "Log in" })).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Documentation" })).toBeNull();
      expect(bar.getByRole("link", { name: "SorobanScan" }).getAttribute("href")).toBe(
        "https://sorobanscan.com/",
      );
      await pageHeading(kind, "prices");
    },
  );

  it("opens the dashboard at the tab of the API the page is about", async () => {
    withX402();
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/quick-start/x402");
    const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
    expect(bar.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe(
      "/api/dashboard/x402",
    );
  });

  // The Prices portal's spec held this for its own two pages, pressing the bar's OpenAPI Docs on
  // the quick start: one tree, one `/me`.
  it("moves between the pages by the bar's links without asking who is signed in again", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/quick-start/prices");
    const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
    fireEvent.click(bar.getByRole("link", { name: "OpenAPI Docs" }));
    await waitFor(() => expect(where).toBe("/docs/prices"));
    await pageHeading("docs", "prices");
    const after = within(screen.getByRole("navigation", { name: "Dashboard" }));
    expect(after.getByRole("link", { name: "OpenAPI Docs" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(after.getByText("nelly")).toBeTruthy();

    fireEvent.click(after.getByRole("link", { name: "Dashboard" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(where).toBe("/dashboard/prices");
    expect(asked(fetchMock, "/api/hub/me")).toBe(1);
  });

  it("offers the hub's Dashboard in the footer only to whoever is signed in", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    const { unmount } = renderAt("/api/quick-start/prices");
    await screen.findByRole("navigation", { name: "Dashboard" });
    const footer = () => within(screen.getByRole("navigation", { name: "Footer" }));
    expect(footer().getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe(
      "/api/dashboard/prices",
    );
    unmount();

    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    await screen.findByRole("link", { name: "Log in" });
    expect(footer().queryByRole("link", { name: "Dashboard" })).toBeNull();
  });

  describe("Sign out", () => {
    const assign = vi.fn();
    beforeEach(() => {
      assign.mockReset();
      // jsdom can't leave the document; the page's way out is recorded instead.
      vi.stubGlobal("location", { assign, origin: "https://sorobanscan.com", hash: "" });
    });

    it("posts to the hub's backend, as the dashboard does, then goes to the hub", async () => {
      const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
      renderAt("/api/quick-start/prices");
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
      await settle();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/hub/auth/logout",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      );
      expect(assign).toHaveBeenCalledExactlyOnceWith("/api/");
    });

    it("stays on the page and says so when the sign-out fails", async () => {
      stubBackend(
        () => answer(200, SIGNED_IN),
        () => answer(500, { error: "internal" }),
      );
      renderAt("/api/quick-start/prices");
      const button = (await screen.findByRole("button", {
        name: "Sign out",
      })) as HTMLButtonElement;
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(button);
      // Shut while the `POST` is out, so one press is one sign-out.
      expect(button.disabled).toBe(true);
      await settle();
      expect(screen.getByRole("alert").textContent).toBe("Sign-out failed. Try again.");
      expect(assign).not.toHaveBeenCalled();
      expect(where).toBe("/quick-start/prices");
      expect(screen.getByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeTruthy();
      // Still signed in, and open again for the try the message asks for.
      expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeTruthy();
      expect(button.disabled).toBe(false);
    });
  });
});

describe("the tabs", () => {
  it.each(KINDS)("are links to each open API's /%s page, the page's own marked", async (kind) => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(`/api/${kind}/x402`);
    const tabs = within(screen.getByRole("tablist", { name: "APIs" }));
    const prices = tabs.getByRole("tab", { name: "Prices API" });
    const x402 = tabs.getByRole("tab", { name: "x402" });
    // Links, so a crawler and a reader without scripts can follow them.
    expect(prices.tagName).toBe("A");
    expect(prices.getAttribute("href")).toBe(`/api/${kind}/prices`);
    expect(x402.tagName).toBe("A");
    expect(x402.getAttribute("href")).toBe(`/api/${kind}/x402`);
    expect(x402.getAttribute("aria-selected")).toBe("true");
    expect(prices.getAttribute("aria-selected")).toBe("false");
    expect(tabs.queryByText("Coming soon")).toBeNull();
    // The page under them is the selected tab's panel.
    const panel = pagePanel();
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(x402.id);
    expect(x402.getAttribute("aria-controls")).toBe(panel.id);
    expect(prices.getAttribute("aria-controls")).toBeNull();
    await pageHeading(kind, "x402");
  });

  it("open the other API's page of the same kind", async () => {
    withX402();
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    fireEvent.click(screen.getByRole("tab", { name: "x402" }));
    expect(await screen.findByRole("heading", { level: 1, name: X402_GUIDE })).toBeTruthy();
    expect(where).toBe("/quick-start/x402");
    expect(screen.queryByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Prices API" }));
    expect(await screen.findByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeTruthy();
    expect(where).toBe("/quick-start/prices");
    expect(asked(fetchMock, "/api/hub/me")).toBe(1);
  });

  it.each(KINDS)("mark x402 as coming soon, and no link, on /%s while the build leaves it off", async (kind) => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(`/api/${kind}/prices`);
    const tabs = within(screen.getByRole("tablist", { name: "APIs" }));
    const prices = tabs.getByRole("tab", { name: "Prices API" });
    expect(prices.getAttribute("href")).toBe(`/api/${kind}/prices`);
    expect(prices.getAttribute("aria-selected")).toBe("true");
    const x402 = tabs.getByRole("tab", { name: /x402/ });
    expect(within(x402).getByText("Coming soon")).toBeTruthy();
    expect(x402.tagName).not.toBe("A");
    expect(x402.getAttribute("href")).toBeNull();
    expect(x402.getAttribute("aria-disabled")).toBe("true");
    // Pressed all the same, it opens nothing.
    fireEvent.click(x402);
    await settle();
    expect(where).toBe(`/${kind}/prices`);
    expect(prices.getAttribute("aria-selected")).toBe("true");
  });
});

describe("the head", () => {
  const TITLES = [
    ["quick-start", "prices", "Stellar Prices API quick start — Soroban Scan APIs"],
    ["quick-start", "x402", "x402 Facilitator quick start — Soroban Scan APIs"],
    ["docs", "prices", "Stellar Prices API reference — Soroban Scan APIs"],
    ["docs", "x402", "x402 Facilitator reference — Soroban Scan APIs"],
  ] as const;
  const meta = (name: string) =>
    document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
  const canonical = () =>
    document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;

  it.each(TITLES)("names /%s/%s, describes it and says where it lives", async (kind, api, title) => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(`/api/${kind}/${api}`);
    await waitFor(() => expect(document.title).toBe(title));
    const description = meta("description");
    expect(description).toMatch(api === "x402" ? /x402 Facilitator/ : /Stellar Prices API/);
    expect(description?.length).toBeGreaterThan(60);
    // One address per page, whatever brought the reader: the tab's own, on this origin.
    expect(canonical()).toBe(`${window.location.origin}/api/${kind}/${api}`);
    expect(canonical()).toMatch(/^https?:\/\//);
    await pageHeading(kind, api);
  });

  it("gives each of the four pages a description of its own", async () => {
    withX402();
    const seen = new Set<string | null>();
    for (const [kind, api, title] of TITLES) {
      stubBackend(() => answer(200, SIGNED_OUT));
      const { unmount } = renderAt(`/api/${kind}/${api}`);
      await waitFor(() => expect(document.title).toBe(title));
      seen.add(meta("description"));
      unmount();
    }
    expect(seen.size).toBe(TITLES.length);
    expect(seen.has(null)).toBe(false);
  });

  // The sign-in and the dashboard are `noindex`; these pages are written to be found, by search
  // engines and by agents, signed in or not.
  it.each([
    ["nobody is signed in", SIGNED_OUT],
    ["somebody is signed in", SIGNED_IN],
  ])("keeps the pages in search results, when %s", async (_who, me) => {
    withX402();
    for (const [kind, api, title] of TITLES) {
      stubBackend(() => answer(200, me));
      const { unmount } = renderAt(`/api/${kind}/${api}`);
      await waitFor(() => expect(document.title).toBe(title));
      await settle();
      expect(meta("robots"), `${kind}/${api}`).toBeNull();
      unmount();
    }
  });

  it("takes the dashboard's noindex off when the bar's link opens a page from it", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard/prices");
    const bar = within(await screen.findByRole("navigation", { name: "Dashboard" }));
    expect(meta("robots")).toBe("noindex");
    fireEvent.click(bar.getByRole("link", { name: "Quick start" }));
    await waitFor(() => expect(where).toBe("/quick-start/prices"));
    await waitFor(() => expect(meta("robots")).toBeNull());
    expect(document.title).toBe("Stellar Prices API quick start — Soroban Scan APIs");
  });
});

describe("the Prices quick start", () => {
  it("is the Prices portal's guide, at /quick-start/prices", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    expect(await screen.findByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^prerequisites$/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: X402_GUIDE })).toBeNull();
    expect(where).toBe("/quick-start/prices");
  });

  // Its own links are routes of the router it is drawn under: here they are the hub's sign-in
  // and dashboard, where under the Prices portal's they were its own.
  it("sends its sign-in and dashboard links to the hub's pages", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    const panel = within(pagePanel());
    expect(panel.getByRole("link", { name: "developer portal" }).getAttribute("href")).toBe(
      "/api/login",
    );
    expect(
      panel.getByRole("link", { name: /monitor your usage/i }).getAttribute("href"),
    ).toBe("/api/dashboard");
    expect(
      panel.getByRole("link", { name: /full api reference/i }).getAttribute("href"),
    ).toBe("/api/docs/prices");
  });

  it("marks the section the quick start opens on in its rail", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    await screen.findByRole("heading", { name: /^prerequisites$/i });

    const rail = within(screen.getByRole("navigation", { name: "On this page" }));
    const entries = rail.getAllByRole("link");
    // The ten frame sections plus "Example queries" (Prices task 0163).
    expect(entries).toHaveLength(11);
    // Unscrolled, the rail points at the first section rather than at nothing: the frame
    // underlines `Prerequisites` for the same reason.
    expect(entries[0].getAttribute("aria-current")).toBe("location");
    expect(entries.filter((entry) => entry.getAttribute("aria-current"))).toHaveLength(1);
  });

  it("switches the first-request snippet by language and copies it", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderAt("/api/quick-start/prices");
    await screen.findByRole("heading", { name: /first request/i });

    const [tabs] = screen.getAllByRole("tablist", { name: "Language" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Python" }));
    expect(within(tabs).getByRole("tab", { name: "Python" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "python" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy python example" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("requests.get(");
    expect(writeText.mock.calls[0][0]).toContain("x-api-key");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});

describe("the x402 quick start", () => {
  it("is x402's own guide, at /quick-start/x402", async () => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/x402");
    expect(await screen.findByRole("heading", { level: 1, name: X402_GUIDE })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: PRICES_GUIDE })).toBeNull();
    // Its links are this tree's routes: x402's reference, tab and sign-in.
    const panel = within(pagePanel());
    const hrefs = panel.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/api/docs/x402");
    expect(hrefs).toContain("/api/dashboard/x402");
    expect(hrefs).toContain("/api/login?from=x402");
  });

  // The guide names the facilitator's paths in prose and in snippets; the reference beside it is
  // drawn from the document. A path in one and not the other is a page that contradicts its
  // neighbour.
  it("names no path the OpenAPI document in this bundle doesn't have", () => {
    expect(DOCUMENTED_PATHS.length).toBeGreaterThan(0);
    for (const path of DOCUMENTED_PATHS) {
      expect(Object.keys(X402_DOCUMENT.paths), path).toContain(path);
    }
  });
});

describe("the Prices reference", () => {
  it("renders the document Prices' API serves, and offers its copy as a file", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/prices");
    expect(await screen.findByRole("heading", { level: 1, name: "API reference" })).toBeTruthy();
    // The document's own content, once it has arrived.
    expect(await screen.findByRole("button", { name: /GET \/v1\/assets/ })).toBeTruthy();
    expect(asked(fetchMock, OPENAPI_JSON)).toBe(1);
    expect(asked(fetchMock, X402_DOCUMENT_URL)).toBe(0);
    expect(screen.getByText(/read from the document the API serves/)).toBeTruthy();
    const file = screen.getByRole("link", { name: "OpenAPI JSON" });
    expect(file.getAttribute("href")).toBe(OPENAPI_JSON_DOWNLOAD);
    expect(file.getAttribute("download")).toBe(OPENAPI_JSON_FILENAME);
    // Prices' key is a header of its own, not a bearer token.
    expect(screen.queryByText("Authorization: Bearer YOUR_API_KEY")).toBeNull();
  });

  it("says so, with a retry, when the document can't be had", async () => {
    let documents = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (url === "/api/hub/me") return answer(200, SIGNED_OUT);
      if (url === OPENAPI_JSON) return (documents += 1) === 1 ? answer(502, {}) : answer(200, FIXTURE);
      throw new Error(`unexpected request to ${String(url)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/api/docs/prices");
    expect((await screen.findByRole("alert")).textContent).toContain("answered 502");
    expect(screen.getByRole("link", { name: "Open the raw document" }).getAttribute("href")).toBe(
      OPENAPI_JSON,
    );
    // The bar and the tabs stay: the page is still a page.
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /GET \/v1\/assets/ })).toBeTruthy();
  });
});

describe("the x402 reference", () => {
  it("renders x402's document from the bundle, every operation of it", async () => {
    withX402();
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/x402");
    expect(await screen.findByRole("heading", { level: 1, name: "API reference" })).toBeTruthy();
    for (const operation of [
      /POST \/verify/,
      /POST \/settle/,
      /GET \/discovery\/resources/,
      /GET \/supported/,
      /GET \/health/,
    ]) {
      expect(await screen.findByRole("button", { name: operation }), String(operation)).toBeTruthy();
    }
    expect(asked(fetchMock, X402_DOCUMENT_URL)).toBe(1);
    expect(asked(fetchMock, OPENAPI_JSON)).toBe(0);
    // Every operation the document has is on the page, and no other.
    const operations = Object.values(X402_DOCUMENT.paths).flatMap((item) => Object.keys(item));
    expect(operations).toHaveLength(5);
    expect(screen.getByText("https://x402-facilitator.sorobanscan.com")).toBeTruthy();
    // None of Prices' document.
    expect(screen.queryByRole("button", { name: /GET \/v1\/assets/ })).toBeNull();
  });

  it("shows the key as a bearer token, and says which requests need it", async () => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/x402");
    expect(await screen.findByText("Authorization: Bearer YOUR_API_KEY")).toBeTruthy();
    // The document's own words for the scheme, since no route needs the key on every request.
    expect(screen.getAllByText(/stellar:pubnet/).length).toBeGreaterThan(0);
    // No route is marked as always needing a key.
    expect(screen.queryByLabelText(/requires an api key/i)).toBeNull();
  });

  it("offers the same document as a file, and doesn't say the API serves it", async () => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/x402");
    const file = await screen.findByRole("link", { name: "OpenAPI JSON" });
    // The address the page itself reads: same-origin, so a browser honours `download`.
    expect(file.getAttribute("href")).toBe(X402_DOCUMENT_URL);
    expect(file.getAttribute("download")).toBe("x402-facilitator-openapi.json");
    // The facilitator doesn't serve its document yet: the page renders a copy and must not
    // claim otherwise.
    expect(screen.queryByText(/read from the document the API serves/)).toBeNull();
    expect(screen.getByText(/Every endpoint, parameter and response of the API\./)).toBeTruthy();
  });

  it("loads the other API's document when its tab is pressed, and keeps none of the first's", async () => {
    withX402();
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/docs/prices");
    expect(await screen.findByRole("button", { name: /GET \/v1\/assets/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "x402" }));
    expect(await screen.findByRole("button", { name: /POST \/verify/ })).toBeTruthy();
    expect(where).toBe("/docs/x402");
    expect(screen.queryByRole("button", { name: /GET \/v1\/assets/ })).toBeNull();
    expect(asked(fetchMock, OPENAPI_JSON)).toBe(1);
    expect(asked(fetchMock, X402_DOCUMENT_URL)).toBe(1);
  });
});

/**
 * Where a page opens (`usePagePlace`), as the Prices portal's router placed these pages while they
 * were its own (`useScrollOnNavigate`; its spec keeps those tests for the routes it still has).
 */
describe("where a page opens", () => {
  const scrolled: string[] = [];
  beforeEach(() => {
    scrolled.length = 0;
    // jsdom has no `scrollIntoView`.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  // A browser jumps to a `#part` only if the part exists when it looks, and on a full load it
  // looks before React has drawn anything. x402's guide draws a chunk later still, and a
  // reference only once its document is in.
  it.each([
    ["/api/quick-start/prices#examples", "examples"],
    ["/api/quick-start#examples", "examples"],
    ["/api/quick-start/x402#bazaar", "bazaar"],
    ["/api/docs/prices#schemas", "schemas"],
    ["/api/docs/x402#op-post-settle", "op-post-settle"],
  ])("lands a load of %s on its part", async (path, id) => {
    withX402();
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt(path);
    await waitFor(() => expect(scrolled).toContain(id));
  });

  it("stays put on a load that names no part", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("scrollY", 0);
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    await screen.findByRole("heading", { name: /^prerequisites$/i });
    await settle();
    expect(scrolled).toEqual([]);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  // A router link keeps the offset of the page it was pressed on: "OpenAPI Docs" pressed at the
  // foot of the guide opened the reference 6,000 px down.
  it("opens a page a link brought the reader to at the top", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("scrollY", 6439);
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    const bar = within(await screen.findByRole("navigation", { name: "Documentation" }));
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(bar.getByRole("link", { name: "OpenAPI Docs" }));
    await waitFor(() => expect(where).toBe("/docs/prices"));
    await pageHeading("docs", "prices");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("opens the other API's tab at the top too", async () => {
    withX402();
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("scrollY", 6439);
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/quick-start/prices");
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "x402" }));
    await screen.findByRole("heading", { level: 1, name: X402_GUIDE });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });
});
