import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/** Where the router is now, under its basename: `MemoryRouter` has no `window.location`. */
let where = "";
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
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
const UNCONFIGURED = () => answer(503, { error: "sign_in_not_configured" });

/** A `fetch` that never answers, as a slow backend, until the page gives up. */
const unanswered = (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/**
 * The hub's backend: `/me` answered by `me`, the sign-out by `logout`. Anything else is a request
 * the pages shouldn't make.
 */
function stubBackend(
  me: () => Response | Promise<Response>,
  logout: () => Response | Promise<Response> = () => new Response(null, { status: 204 }),
) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (url === "/api/hub/me" && (init?.method ?? "GET") === "GET") return me();
    if (url === "/api/hub/auth/logout" && init?.method === "POST") return logout();
    throw new Error(`unexpected request to ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Lets the page take in an answer `fetch` already has: every promise chained on it settles. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const SIGN_IN_URL = "/api/hub/auth/login";
/** Every link on the page that starts a sign-in. */
const signInLinks = () =>
  screen.queryAllByRole("link").filter((a) => a.getAttribute("href") === SIGN_IN_URL);

beforeEach(() => {
  where = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/login", () => {
  it("says it is checking while the backend hasn't answered", () => {
    vi.stubGlobal("fetch", vi.fn(unanswered));
    renderAt("/api/login");
    expect(screen.getByTestId("login-card")).toBeTruthy();
    expect(screen.getByText("Checking whether you are signed in…")).toBeTruthy();
    expect(signInLinks()).toEqual([]);
  });

  it("asks the hub's backend who is signed in, once, with the page's own cookies", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/me",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("offers Sign in with Discord on the Prices login card, and says who may sign in", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login");
    const button = await screen.findByRole("link", { name: "Sign in with Discord" });
    expect(button.getAttribute("href")).toBe(SIGN_IN_URL);
    // A plain link: the round trip is a top-level navigation, no popup.
    expect(button.getAttribute("target")).toBeNull();
    const card = screen.getByTestId("login-card");
    expect(within(card).getByRole("heading", { level: 1 })).toBeTruthy();
    const who = screen.getByTestId("prerequisites");
    expect(who.textContent).toMatch(/Stellar Developers Discord/);
    expect(who.textContent).toMatch(/membership screening/i);
    expect(within(who).getByRole("link", { name: "Stellar Developers Discord" })).toBeTruthy();
    expect(screen.getByText("What you get")).toBeTruthy();
    expect(screen.queryByText("OAuth error")).toBeNull();
    expect(screen.getByRole("link", { name: /Back to landing/ }).getAttribute("href")).toBe("/api/");
  });

  it("names the page and keeps it out of search results", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login");
    await screen.findByRole("link", { name: "Sign in with Discord" });
    expect(document.title).toBe("Soroban Scan APIs — Sign in");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex",
    );
  });

  // The Prices portal's words for the same outcomes (`LoginView` in `src/prices/app/app.tsx`).
  it.each(["cancelled", "failed"])(
    "says Discord returned an error on ?signin=%s, and offers to try again",
    async (reason) => {
      stubBackend(() => answer(200, SIGNED_OUT));
      renderAt(`/api/login?signin=${reason}`);
      expect(await screen.findByText("OAuth error")).toBeTruthy();
      expect(screen.getByTestId("signin-failed").textContent).toBe(
        "Discord returned an error during authorization. This can happen if you denied access or if the session timed out.",
      );
      const again = screen.getByRole("link", { name: "Try again with Discord" });
      expect(again.getAttribute("href")).toBe(SIGN_IN_URL);
      expect(screen.getByRole("link", { name: "contact support" })).toBeTruthy();
    },
  );

  it("says an account outside Stellar Developers must join, on ?signin=not_member", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=not_member");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Access not available" }),
    ).toBeTruthy();
    expect(screen.getByText("Stellar Discord membership required")).toBeTruthy();
    expect(screen.getByTestId("signin-not-member").textContent).toBe(
      "API keys are available to members of the Stellar Developers Discord server. Join the server and try again.",
    );
    const join = screen.getByRole("link", { name: "Join Stellar Discord" });
    expect(join.getAttribute("href")).toBe("https://discord.gg/stellardev");
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toBe("noopener noreferrer");
    // Signing in again as the same account would end in the same refusal.
    expect(signInLinks()).toEqual([]);
  });

  it("says an account in screening must accept the rules, on ?signin=pending_rules", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=pending_rules");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Access not available" }),
    ).toBeTruthy();
    expect(screen.getByText("Stellar Discord accept rules required")).toBeTruthy();
    expect(screen.getByTestId("signin-pending-rules").textContent).toBe(
      "Your Discord account is on the Stellar Developers server, but you have not accepted its rules yet. Open Discord, accept the server's rules, then sign in again.",
    );
    const open = screen.getByRole("link", { name: "Open Stellar Discord" });
    expect(open.getAttribute("href")).toBe("https://discord.com/channels/897514728459468821");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      SIGN_IN_URL,
    );
  });

  it("offers a way to switch Discord account on a refusal", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=not_member");
    fireEvent.click(await screen.findByRole("button", { name: "Try different account" }));
    const dialog = screen.getByRole("dialog", { name: "Use a different Discord account" });
    expect(
      within(dialog).getByRole("link", { name: "Switch account on Discord" }).getAttribute("href"),
    ).toBe("https://discord.com/login");
    expect(
      within(dialog).getByRole("link", { name: "Try signing in again" }).getAttribute("href"),
    ).toBe(SIGN_IN_URL);
  });

  it("says Discord didn't answer, not that the account isn't a member, on ?signin=unknown", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=unknown");
    expect(await screen.findByText("We could not check your membership")).toBeTruthy();
    expect(screen.getByTestId("signin-unknown").textContent).toBe(
      "That is a problem talking to Discord, not a statement about your membership. Please try signing in again shortly.",
    );
    expect(screen.queryByText(/membership required/)).toBeNull();
    // Retrying is the whole remedy, so the button stays.
    expect(screen.getByRole("link", { name: "Sign in with Discord" }).getAttribute("href")).toBe(
      SIGN_IN_URL,
    );
  });

  it("reads ?signin= once and takes it off the address, keeping what it said", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=not_member&from=prices");
    await screen.findByTestId("signin-not-member");
    await settle();
    expect(where).toBe("/login?from=prices");
    expect(screen.getByTestId("signin-not-member")).toBeTruthy();
  });

  it("shows the ordinary card for a reason it doesn't know", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=bogus");
    expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
    expect(screen.queryByText("OAuth error")).toBeNull();
    expect(screen.queryByText(/We could not check/)).toBeNull();
    await settle();
    expect(where).toBe("/login");
  });

  it("says sign-in is not configured, with no button, when the backend has no settings", async () => {
    stubBackend(UNCONFIGURED);
    renderAt("/api/login");
    expect(await screen.findByText(/Sign-in is not configured on this server/)).toBeTruthy();
    expect(signInLinks()).toEqual([]);
    expect(screen.queryByRole("link", { name: /Discord/ })).toBeNull();
  });

  it.each([
    ["a 503 for another reason", () => answer(503, { error: "busy" })],
    ["a failure", () => answer(500, SIGNED_IN)],
    ["no answer", () => Promise.reject(new TypeError("fetch failed"))],
    ["a page, not JSON", () => new Response("<!doctype html>", { status: 200 })],
    ["another form of yes", () => answer(200, { authenticated: "true", id: "1", username: "x" })],
  ])("offers sign-in after %s", async (_, me) => {
    stubBackend(me);
    renderAt("/api/login");
    expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
  });

  it("sends whoever is signed in to the dashboard", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(where).toBe("/dashboard");
    // The dashboard uses the answer the sign-in page had.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("/dashboard", () => {
  it("says it is checking while the backend hasn't answered", () => {
    vi.stubGlobal("fetch", vi.fn(unanswered));
    renderAt("/api/dashboard");
    expect(screen.getByText("Checking whether you are signed in…")).toBeTruthy();
    expect(where).toBe("/dashboard");
  });

  it.each([
    ["nobody is signed in", () => answer(200, SIGNED_OUT)],
    ["the backend fails", () => answer(500, {})],
    ["the session is no longer good", () => answer(200, { authenticated: false })],
  ])("goes to /login when %s", async (_, me) => {
    stubBackend(me);
    renderAt("/api/dashboard");
    expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
    expect(where).toBe("/login");
  });

  it("goes to /login, which says why, when sign-in isn't configured", async () => {
    stubBackend(UNCONFIGURED);
    renderAt("/api/dashboard");
    expect(await screen.findByText(/Sign-in is not configured on this server/)).toBeTruthy();
    expect(where).toBe("/login");
  });

  it("shows the Prices dashboard's bar: its pages, the account and Sign out", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Dashboard" });
    const dashboard = within(nav).getByRole("link", { name: "Dashboard" });
    expect(dashboard.getAttribute("href")).toBe("/api/dashboard");
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Quick start" }).getAttribute("href")).toBe(
      "/api/prices-api/quick-start",
    );
    expect(within(nav).getByRole("link", { name: "OpenAPI Docs" }).getAttribute("href")).toBe(
      "/api/prices-api/docs",
    );
    expect(within(nav).getByText("nelly")).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("names the page and keeps it out of search results", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(document.title).toBe("Soroban Scan APIs — Dashboard");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex",
    );
  });

  it("has a tab for each API, Prices selected and x402 coming soon", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    const tabs = await screen.findByRole("tablist");
    const [prices, x402, ...more] = within(tabs).getAllByRole("tab");
    expect(more).toEqual([]);
    expect(prices?.textContent).toBe("Prices API");
    expect(prices?.getAttribute("aria-selected")).toBe("true");
    expect(x402?.textContent).toMatch(/^x402/);
    expect(x402?.textContent).toMatch(/Coming soon/);
    expect(x402?.getAttribute("aria-selected")).toBe("false");
    expect(x402?.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(x402!);
    expect(x402?.getAttribute("aria-selected")).toBe("false");
    expect(prices?.getAttribute("aria-selected")).toBe("true");
    expect(where).toBe("/dashboard");
  });

  it("says in the Prices tab that its key and usage connect in the next step", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    const panel = await screen.findByRole("tabpanel", { name: "Prices API" });
    expect(panel.textContent).toMatch(/key, usage and limits connect here in the next step/);
    // Nothing made up: no figures until the Prices backend gives them.
    expect(panel.textContent).not.toMatch(/\d/);
  });

  it("keeps x402 shut on /dashboard/x402 while it is off", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard/x402");
    expect(await screen.findByRole("tabpanel", { name: "Prices API" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^x402/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("opens the x402 tab when the build turns it on", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    const x402 = await screen.findByRole("tab", { name: "x402" });
    expect(x402.getAttribute("aria-disabled")).toBeNull();
    expect(x402.textContent).not.toMatch(/Coming soon/);

    fireEvent.click(x402);
    expect(x402.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "x402" })).toBeTruthy();
    expect(where).toBe("/dashboard/x402");
  });

  it("opens the tab its address names", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard/x402");
    expect(await screen.findByRole("tabpanel", { name: "x402" })).toBeTruthy();
  });

  describe("Sign out", () => {
    const assign = vi.fn();
    beforeEach(() => {
      assign.mockReset();
      // jsdom can't leave the document; the page's way out is recorded instead.
      vi.stubGlobal("location", { assign });
    });

    it("posts to the hub's backend, then goes to the hub", async () => {
      const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
      renderAt("/api/dashboard");
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
      await settle();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/hub/auth/logout",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      );
      expect(assign).toHaveBeenCalledExactlyOnceWith("/api/");
    });

    it.each([
      ["refuses it", () => answer(400, { error: "bad_origin" })],
      ["can't be reached", () => Promise.reject(new TypeError("fetch failed"))],
    ])("still goes to the hub when the backend %s, where /me decides", async (_, logout) => {
      stubBackend(() => answer(200, SIGNED_IN), logout);
      renderAt("/api/dashboard");
      fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
      await settle();
      expect(assign).toHaveBeenCalledExactlyOnceWith("/api/");
    });
  });
});
