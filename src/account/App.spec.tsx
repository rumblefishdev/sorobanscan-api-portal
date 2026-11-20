import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ME_TIMEOUT_MS } from "./session";

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
const UNCONFIGURED = () => answer(503, { error: "sign_in_not_configured" });

/** A `fetch` that never answers, as a slow backend, until the page gives up. */
const unanswered = (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/** Prices' account with no key, as the hub's backend passes it on (`PricesTab.spec.tsx` has more). */
const NO_KEY = {
  key: { state: "none", can_issue: true },
  details: { usage: null, free_rate_limit_per_second: 1 },
};

/** x402's account with no key (`x402/X402Tab.spec.tsx` has more). */
const X402_NO_KEY = { key: { state: "none", can_issue: true }, details: { showable: false } };

/**
 * The hub's backend: `/me` answered by `me`, the sign-out by `logout`, the Prices tab's account
 * with no key. Anything else is a request the pages shouldn't make.
 */
function stubBackend(
  me: () => Response | Promise<Response>,
  logout: () => Response | Promise<Response> = () => new Response(null, { status: 204 }),
) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (url === "/api/hub/me" && (init?.method ?? "GET") === "GET") return me();
    if (url === "/api/hub/auth/logout" && init?.method === "POST") return logout();
    if (url === "/api/hub/prices/account" && (init?.method ?? "GET") === "GET") {
      return answer(200, NO_KEY);
    }
    if (url === "/api/hub/x402/account" && (init?.method ?? "GET") === "GET") {
      return answer(200, X402_NO_KEY);
    }
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
  vi.useRealTimers();
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
    // Prices' first promise, kept (akot, 2026-11-19): the key is one press away once signed in.
    const benefits = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(benefits[0]).toBe("Instant API key — no waiting");
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

  // The backend's limit on its sign-in routes, by address: over it, it sends the browser here.
  it("says there were too many sign-in attempts, on ?signin=busy, and takes it off the address", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?signin=busy&from=prices");
    expect((await screen.findByTestId("signin-busy")).textContent).toBe(
      "Too many sign-in attempts from your network. Try again in a minute.",
    );
    expect(screen.queryByText("OAuth error")).toBeNull();
    expect(screen.queryByText(/membership required/)).toBeNull();
    // Trying again in a minute is the remedy, so the button stays.
    expect(screen.getByRole("link", { name: "Sign in with Discord" }).getAttribute("href")).toBe(
      SIGN_IN_URL,
    );
    await settle();
    expect(where).toBe("/login?from=prices");
    expect(screen.getByTestId("signin-busy")).toBeTruthy();
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
    [
      "a 503 for another reason",
      () => answer(503, { error: "busy" }),
      "/api/hub/me answered 503",
    ],
    ["a failure", () => answer(500, SIGNED_IN), "/api/hub/me answered 500"],
    [
      "no answer",
      () => Promise.reject(new TypeError("fetch failed")),
      "/api/hub/me could not be reached",
    ],
    [
      "a page, not JSON",
      () => new Response("<!doctype html>", { status: 200 }),
      "/api/hub/me answered 200, not JSON",
    ],
    [
      "another form of yes",
      () => answer(200, { authenticated: "true", id: "1", username: "x" }),
      "/api/hub/me answered 200 without a sign-in status",
    ],
  ])("says it could not check, and still offers sign-in, after %s", async (_, me, reason) => {
    stubBackend(me);
    renderAt("/api/login");
    expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
    expect(screen.getByTestId("session-check-failed").textContent).toBe(
      `Could not check your sign-in status: ${reason}`,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("sends whoever is signed in to the dashboard", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(where).toBe("/dashboard");
    // The dashboard uses the answer the sign-in page had.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/me")).toHaveLength(1);
  });

  // The Prices pages send their sign-in here as `?from=prices` (the shared sign-in spec, cutover
  // step 3): a visitor who is signed in already goes to the tab they came from.
  it("sends whoever is signed in to the Prices tab, on ?from=prices", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login?from=prices");
    expect(await screen.findByRole("tabpanel", { name: "Prices API" })).toBeTruthy();
    expect(where).toBe("/dashboard/prices");
  });

  it("sends whoever is signed in to the x402 tab on ?from=x402, once the build opens it", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login?from=x402");
    expect(await screen.findByRole("tabpanel", { name: "x402" })).toBeTruthy();
    expect(where).toBe("/dashboard/x402");
  });

  // Only a product's name is read from `?from=`, never a path or an address, so no value of it
  // sends anyone anywhere but a tab of the dashboard.
  it.each([
    "bogus",
    "",
    "PRICES",
    "https://evil.example/",
    "//evil.example",
    "/dashboard/x402",
    "../prices",
    "prices/../../hub/auth/logout",
  ])("sends whoever is signed in to the dashboard, on ?from=%j", async (from) => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt(`/api/login?from=${encodeURIComponent(from)}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(where).toBe("/dashboard");
  });

  it("offers the sign-in on ?from=prices, and leaves it on the address", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    renderAt("/api/login?from=prices");
    const button = await screen.findByRole("link", { name: "Sign in with Discord" });
    expect(button.getAttribute("href")).toBe(SIGN_IN_URL);
    await settle();
    expect(where).toBe("/login?from=prices");
  });

  it("points a signed-in visitor back from a refused round trip at the Prices tab, on ?from=prices", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login?signin=failed&from=prices");
    const back = await screen.findByRole("link", { name: "Go to your dashboard" });
    expect(back.getAttribute("href")).toBe("/api/dashboard/prices");
    fireEvent.click(back);
    expect(await screen.findByRole("tabpanel", { name: "Prices API" })).toBeTruthy();
    expect(where).toBe("/dashboard/prices");
  });

  // An issue's round trip left open for more than 10 minutes comes back as a sign-in's failure:
  // the hub can no longer tell it was an issue. The visitor is still signed in.
  it.each(["failed", "cancelled", "not_member", "unknown"])(
    "keeps a signed-in visitor on ?signin=%s, with the way back to the dashboard",
    async (reason) => {
      stubBackend(() => answer(200, SIGNED_IN));
      renderAt(`/api/login?signin=${reason}`);
      expect(
        await screen.findByRole("heading", { level: 1, name: "You are still signed in" }),
      ).toBeTruthy();
      expect(screen.getByTestId("still-signed-in").textContent).toBe(
        "That round trip through Discord did not complete, so nothing changed: you are still signed in as nelly. If you were getting an API key, ask for it again on your dashboard.",
      );
      expect(screen.queryByText("OAuth error")).toBeNull();
      expect(signInLinks()).toEqual([]);
      await settle();
      expect(where).toBe("/login");

      fireEvent.click(screen.getByRole("link", { name: "Go to your dashboard" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
      expect(where).toBe("/dashboard");
    },
  );

  // "Get API Key" posted in this tab, over the backend's limit: asking again at once on the
  // dashboard would meet the same refusal, so the card says to wait.
  it("keeps a signed-in visitor on ?signin=busy, and says to wait a minute", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/login?signin=busy");
    expect(
      await screen.findByRole("heading", { level: 1, name: "You are still signed in" }),
    ).toBeTruthy();
    expect(screen.getByTestId("signin-busy").textContent).toBe(
      "Too many sign-in attempts from your network. Try again in a minute.",
    );
    expect(screen.getByTestId("still-signed-in")).toBeTruthy();
    expect(signInLinks()).toEqual([]);
    await settle();
    expect(where).toBe("/login");
  });
});

/**
 * The sign-in in a second window, as the Prices portal's (akot, 2026-11-19): the page stays, says
 * it is waiting, and takes the outcome from the window when it comes back.
 */
describe("/login's Discord window", () => {
  /** What `window.open` hands back: enough of a window for the page to watch. */
  const fakeWindow = () => ({ closed: false, focus: vi.fn() });
  const opens = (popup: unknown) =>
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  /** The window's last word, as `bridgeOAuthPopup` posts it from where the backend left it. */
  const windowLands = (search: string, origin = window.location.origin) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { origin, data: { source: "stellar-portal-oauth", search } }),
      );
    });
  const press = async (name: string) => {
    const link = await screen.findByRole("link", { name });
    // `fireEvent` answers whether the default went ahead: false once the page took the click.
    return fireEvent.click(link);
  };

  /** The same press with the page's timers held, so a test moves the window's watch by hand. */
  const pressUnderFakeTimers = async (name: string) => {
    const link = await screen.findByRole("link", { name });
    vi.useFakeTimers();
    return fireEvent.click(link);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens Discord in a second window and says it is waiting", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    const open = opens(fakeWindow());
    renderAt("/api/login");
    const wentAhead = await press("Sign in with Discord");
    expect(wentAhead).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe(SIGN_IN_URL);
    expect(screen.getByRole("heading", { level: 1, name: "Redirecting to Discord" })).toBeTruthy();
    expect(screen.getByText("Discord authorization window opened.")).toBeTruthy();
    expect(screen.getByText("Waiting for Discord…")).toBeTruthy();
    // The way on for a visitor whose window never showed: the same sign-in, in this tab.
    expect(screen.getByRole("link", { name: "click here" }).getAttribute("href")).toBe(SIGN_IN_URL);
    expect(screen.getByRole("link", { name: /Back to landing/ })).toBeTruthy();
  });

  it("leaves the click to the browser when the window is blocked", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    opens(null);
    renderAt("/api/login");
    const wentAhead = await press("Sign in with Discord");
    expect(wentAhead).toBe(true);
    expect(screen.queryByText("Redirecting to Discord")).toBeNull();
  });

  it("leaves a click that asks for a tab of its own to the browser", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    const open = opens(fakeWindow());
    renderAt("/api/login");
    const link = await screen.findByRole("link", { name: "Sign in with Discord" });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("goes to the dashboard once the window comes back signed in", async () => {
    let me: unknown = SIGNED_OUT;
    const fetchMock = stubBackend(() => answer(200, me));
    opens(fakeWindow());
    renderAt("/api/login?from=prices");
    await press("Sign in with Discord");
    me = SIGNED_IN;
    await windowLands("");
    await settle();
    expect(where).toBe("/dashboard/prices");
    // Asked again, since the window's word alone is no proof of a session.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/me").length).toBe(2);
  });

  it("shows the refusal the window came back with", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    opens(fakeWindow());
    renderAt("/api/login");
    await press("Sign in with Discord");
    await windowLands("?signin=not_member");
    expect(screen.getByTestId("signin-not-member")).toBeTruthy();
    expect(screen.queryByText("Waiting for Discord…")).toBeNull();
  });

  // The window's sign-in met the backend's limit: said here, on the page that opened it.
  it("shows the window's refusal over the limit, without asking the backend", async () => {
    const fetchMock = stubBackend(() => answer(200, SIGNED_OUT));
    opens(fakeWindow());
    renderAt("/api/login");
    await press("Sign in with Discord");
    await windowLands("?signin=busy");
    expect(screen.getByTestId("signin-busy").textContent).toBe(
      "Too many sign-in attempts from your network. Try again in a minute.",
    );
    expect(screen.queryByTestId("signin-failed")).toBeNull();
    expect(screen.queryByText("Waiting for Discord…")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/me").length).toBe(1);
  });

  it("says the sign-in failed when the window says it worked and the backend disagrees", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    opens(fakeWindow());
    renderAt("/api/login");
    await press("Sign in with Discord");
    await windowLands("");
    await settle();
    expect(screen.getByTestId("signin-failed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again with Discord" })).toBeTruthy();
  });

  it("ignores a message from another origin", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    opens(fakeWindow());
    renderAt("/api/login");
    await press("Sign in with Discord");
    await windowLands("?signin=not_member", "https://elsewhere.example");
    expect(screen.getByText("Waiting for Discord…")).toBeTruthy();
  });

  it("says the sign-in did not complete when the window is shut without a word", async () => {
    stubBackend(() => answer(200, SIGNED_OUT));
    const popup = fakeWindow();
    opens(popup);
    renderAt("/api/login");
    await pressUnderFakeTimers("Sign in with Discord");
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByTestId("signin-failed")).toBeTruthy();
  });

  it("goes to the dashboard when the window is shut after a sign-in that worked", async () => {
    let me: unknown = SIGNED_OUT;
    stubBackend(() => answer(200, me));
    const popup = fakeWindow();
    opens(popup);
    renderAt("/api/login?from=prices");
    await pressUnderFakeTimers("Sign in with Discord");
    me = SIGNED_IN;
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(where).toBe("/dashboard/prices");
  });

  it("goes to the dashboard when the backend says signed in though the window said nothing", async () => {
    let me: unknown = SIGNED_OUT;
    stubBackend(() => answer(200, me));
    opens(fakeWindow());
    renderAt("/api/login?from=prices");
    await pressUnderFakeTimers("Sign in with Discord");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Waiting for Discord…")).toBeTruthy();
    me = SIGNED_IN;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(where).toBe("/dashboard/prices");
  });

  it("forgets the address's refusal once a new sign-in works", async () => {
    let me: unknown = SIGNED_OUT;
    stubBackend(() => answer(200, me));
    opens(fakeWindow());
    renderAt("/api/login?signin=failed&from=prices");
    await press("Try again with Discord");
    me = SIGNED_IN;
    await windowLands("");
    await settle();
    expect(where).toBe("/dashboard/prices");
    expect(screen.queryByTestId("still-signed-in")).toBeNull();
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
    ["the session is no longer good", () => answer(200, { authenticated: false })],
  ])("goes to /login when %s", async (_, me) => {
    stubBackend(me);
    renderAt("/api/dashboard");
    expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
    expect(where).toBe("/login");
  });

  // Review focus 4: not knowing is not "signed out". A signed-in visitor whose `/me` failed stays
  // here, told so, with a retry.
  it.each([
    ["fails", () => answer(500, {}), "/api/hub/me answered 500"],
    ["is busy", () => answer(503, { error: "busy" }), "/api/hub/me answered 503"],
    ["can't be reached", () => Promise.reject(new TypeError("fetch failed")), "/api/hub/me could not be reached"],
    [
      "answers the CDN's page",
      () => new Response("<!doctype html>", { status: 200 }),
      "/api/hub/me answered 200, not JSON",
    ],
  ])("stays, says it could not check and offers a retry, when /me %s", async (_, me, reason) => {
    stubBackend(me);
    renderAt("/api/dashboard/prices");
    expect((await screen.findByTestId("session-check-failed")).textContent).toBe(
      `Could not check your sign-in status: ${reason}`,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    await settle();
    expect(where).toBe("/dashboard/prices");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("asks /me again on Try again, and shows the dashboard once it answers", async () => {
    const answers = [answer(502, {}), answer(200, SIGNED_IN)];
    const fetchMock = stubBackend(() => answers.shift() ?? answer(500, {}));
    renderAt("/api/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tablist")).toBeTruthy();
    expect(where).toBe("/dashboard");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/me")).toHaveLength(2);
  });

  it("gives up on /me after 10 seconds, as a failure, not a sign-out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(unanswered));
    renderAt("/api/dashboard");
    expect(ME_TIMEOUT_MS).toBe(10_000);
    await act(() => vi.advanceTimersByTimeAsync(ME_TIMEOUT_MS - 1));
    expect(screen.getByText("Checking whether you are signed in…")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByTestId("session-check-failed").textContent).toBe(
      "Could not check your sign-in status: /api/hub/me did not answer within 10 s",
    );
    expect(where).toBe("/dashboard");
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
    // Each of the bar's links keeps to the open tab's API.
    expect(dashboard.getAttribute("href")).toBe("/api/dashboard/prices");
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Quick start" }).getAttribute("href")).toBe(
      "/api/quick-start/prices",
    );
    expect(within(nav).getByRole("link", { name: "OpenAPI Docs" }).getAttribute("href")).toBe(
      "/api/docs/prices",
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

  it("shows the Prices dashboard's cards in the Prices tab", async () => {
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    const panel = await screen.findByRole("tabpanel", { name: "Prices API" });
    for (const title of ["API Key", "Monthly Usage", "Rate Limit"]) {
      expect(await within(panel).findByRole("heading", { level: 2, name: title })).toBeTruthy();
    }
    expect(panel.textContent).not.toMatch(/connect here in the next step/);
  });

  // Where the hub's backend sends "Get API Key" for a product it doesn't serve: no tab is named,
  // so the first open one says the issue failed.
  it("says on the first open tab that an issue failed, on /dashboard?issue=failed", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard?issue=failed");
    const panel = await screen.findByRole("tabpanel", { name: "Prices API" });
    expect(within(panel).getByTestId("issue-failed").textContent).toMatch(
      /^We could not create your key\./,
    );
    await settle();
    expect(where).toBe("/dashboard");
  });

  it.each([
    ["/api/dashboard/x402", "a tab that is off"],
    ["/api/dashboard/bogus", "a tab it doesn't know"],
    ["/api/dashboard/x402?issue=issued", "an issue's outcome for a tab that is off"],
  ])("replaces %s, %s, with the first open tab", async (path) => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    stubBackend(() => answer(200, SIGNED_IN));
    renderAt(path);
    expect(await screen.findByRole("tabpanel", { name: "Prices API" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^x402/ }).getAttribute("aria-selected")).toBe("false");
    // The outcome was another tab's: it isn't carried to this one.
    expect(where).toBe("/dashboard/prices");
    expect(screen.queryByTestId("issue-issued")).toBeNull();
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

  it("shows the x402 tab's key card at /dashboard/x402, and Prices' at its own address", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard/x402");
    const panel = await screen.findByRole("tabpanel", { name: "x402" });
    expect(await within(panel).findByRole("button", { name: "Get API Key" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { level: 2, name: "Mainnet (pubnet)" })).toBeTruthy();
    expect(within(panel).queryByText(/Coming soon|connect here/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/hub/x402/account", expect.anything());
    // Only the open tab asks: Prices' account isn't read while x402's is shown.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/hub/prices/account", expect.anything());
  });

  it("asks nothing of x402 while its tab is off", async () => {
    vi.stubEnv("VITE_PRODUCTS", "prices");
    const fetchMock = stubBackend(() => answer(200, SIGNED_IN));
    renderAt("/api/dashboard");
    await screen.findByRole("tabpanel", { name: "Prices API" });
    fireEvent.click(screen.getByRole("tab", { name: /^x402/ }));
    await settle();
    expect(screen.getByRole("tab", { name: /^x402/ }).textContent).toMatch(/Coming soon/);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/x402/")))
      .toEqual([]);
  });

  // Only the selected tab's panel is rendered, so only that tab may name one: an
  // `aria-controls` that points at nothing sends a screen reader nowhere.
  it.each(["prices", "prices,x402"])(
    "points only the selected tab at its panel, with VITE_PRODUCTS=%s",
    async (products) => {
      vi.stubEnv("VITE_PRODUCTS", products);
      stubBackend(() => answer(200, SIGNED_IN));
      renderAt("/api/dashboard");
      const panel = await screen.findByRole("tabpanel", { name: "Prices API" });
      const prices = screen.getByRole("tab", { name: "Prices API" });
      const x402 = screen.getByRole("tab", { name: /^x402/ });
      expect(prices.getAttribute("aria-controls")).toBe(panel.id);
      expect(x402.getAttribute("aria-controls")).toBeNull();

      fireEvent.click(x402);
      const selected = screen
        .getAllByRole("tab")
        .filter((tab) => tab.getAttribute("aria-selected") === "true");
      expect(selected).toHaveLength(1);
      for (const tab of screen.getAllByRole("tab")) {
        const controls = tab.getAttribute("aria-controls");
        if (tab === selected[0]) {
          expect(controls).toBe(screen.getByRole("tabpanel").id);
        } else {
          expect(controls, tab.textContent ?? "").toBeNull();
        }
      }
    },
  );

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

    // Only the backend's 204 clears the `HttpOnly` cookie. Leaving on anything else would look
    // like a sign-out while this browser is still signed in, which on a shared machine is the one
    // outcome the button is there to prevent.
    it.each([
      ["refuses it", () => answer(400, { error: "bad_origin" })],
      ["fails", () => answer(500, { error: "internal" })],
      ["answers 200, not 204", () => answer(200, {})],
      ["can't be reached", () => Promise.reject(new TypeError("fetch failed"))],
    ])("stays on the dashboard and says so when the backend %s", async (_, logout) => {
      stubBackend(() => answer(200, SIGNED_IN), logout);
      renderAt("/api/dashboard");
      const button = await screen.findByRole("button", { name: "Sign out" });
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(button);
      await settle();
      expect(assign).not.toHaveBeenCalled();
      expect(where).toBe("/dashboard");
      expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe("Sign-out failed. Try again.");
      // Open again, for the try the message asks for.
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });

    it("signs out on a second try after a failed one", async () => {
      const outcomes = [answer(503, {}), new Response(null, { status: 204 })];
      const fetchMock = stubBackend(
        () => answer(200, SIGNED_IN),
        () => outcomes.shift() ?? answer(500, {}),
      );
      renderAt("/api/dashboard");
      const button = await screen.findByRole("button", { name: "Sign out" });
      fireEvent.click(button);
      await settle();
      expect(screen.getByRole("alert")).toBeTruthy();

      fireEvent.click(button);
      await settle();
      expect(assign).toHaveBeenCalledExactlyOnceWith("/api/");
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/auth/logout")).toHaveLength(2);
    });

    it("sends one POST however often Sign out is pressed while it is in flight", async () => {
      let finish: (response: Response) => void = () => {};
      const fetchMock = stubBackend(
        () => answer(200, SIGNED_IN),
        () => new Promise<Response>((resolve) => (finish = resolve)),
      );
      renderAt("/api/dashboard");
      const button = await screen.findByRole("button", { name: "Sign out" });
      fireEvent.click(button);
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      fireEvent.click(button);
      await settle();
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/hub/auth/logout")).toHaveLength(1);
      expect(assign).not.toHaveBeenCalled();

      await act(async () => finish(new Response(null, { status: 204 })));
      await settle();
      expect(assign).toHaveBeenCalledExactlyOnceWith("/api/");
    });
  });
});

describe("an address under an API's page", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PRODUCTS", "prices,x402");
    stubBackend(() => answer(200, SIGNED_IN));
  });

  it.each([
    ["/docs/prices/anything", "/docs/prices"],
    ["/docs/x402/a/b", "/docs/x402"],
    ["/quick-start/x402/extra", "/quick-start/x402"],
    // An unknown API: the page puts it on the first tab, as it does without the extra part.
    ["/docs/nope/x", "/docs/prices"],
    ["/docs/prices/x#rate-limits", "/docs/prices#rate-limits"],
  ])("%s goes to %s", async (from, to) => {
    renderAt(`/api${from}`);
    await vi.waitFor(() => expect(where).toBe(to));
  });

  it("keeps /docs/prices/ where it is", async () => {
    renderAt("/api/docs/prices/");
    await settle();
    expect(where).toBe("/docs/prices/");
  });

  it.each(["/login/extra", "/dashboard/prices/extra"])(
    "leaves the account pages for the landing page at %s",
    async (from) => {
    const replace = vi.fn();
    vi.stubGlobal("location", { replace });
    renderAt(`/api${from}`);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/api/");
    },
  );
});
