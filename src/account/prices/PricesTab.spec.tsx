import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

/**
 * The dashboard's Prices tab, through the account pages' `App`, on the hub's backend in memory:
 * `/me` for the session and the three Prices routes the tab calls (`bff/src/products/prices.ts`).
 */

let where = "";
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter basename="/api" initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );

const answer = (status: number, body: unknown) => Response.json(body, { status });
const SIGNED_IN = { authenticated: true, id: "80351110224678912", username: "nelly" };
const KEY_VALUE = "mHNVA7eOQ53h5UdLTVpSn2yjDizblKRQ62l61ko4";
const MASK = "••••••••••••••••••••••••••••••••";

/** Prices' `UsageResponse`, a Lite key on its month. */
const USAGE = {
  used: 42180,
  remaining: 57820,
  limit: 100000,
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  resets_at: "2026-12-01T00:00:00Z",
  as_of: "2026-11-18T12:00:00Z",
  plan: {
    tier: "lite",
    name: "lite",
    rate_limit_per_second: 10,
    burst_limit: 20,
    quota_limit: 100000,
    quota_period: "MONTH",
  },
};
const details = (usage: unknown = USAGE) => ({ usage, free_rate_limit_per_second: 1 });

const NO_KEY = { key: { state: "none", can_issue: true }, details: details(null) };
const ACTIVE = {
  key: {
    state: "active",
    key_id: "jfgkw6r9na",
    created_at: "2026-09-02T10:00:00Z",
    last_updated_at: "2026-09-02T10:00:00Z",
    can_issue: false,
  },
  details: details(),
};
const REVOKED_CAPPED = {
  key: {
    state: "revoked",
    revoked_at: "2026-11-10T09:00:00Z",
    next_eligible_at: "2026-12-01T00:00:00Z",
    can_issue: false,
  },
  details: details(),
};
const REVOKED_OPEN = {
  key: {
    state: "revoked",
    revoked_at: "2026-10-10T09:00:00Z",
    next_eligible_at: "2026-11-01T00:00:00Z",
    can_issue: true,
  },
  details: details(null),
};
const REVEALED = {
  key_id: "jfgkw6r9na",
  name: "discord-80351110224678912-key",
  value: KEY_VALUE,
  created_at: "2026-09-02T10:00:00Z",
  last_updated_at: "2026-09-02T10:00:00Z",
};
const REVOCATION = {
  revoked: true,
  next_eligible_at: "2026-12-01T00:00:00Z",
  revoked_at: "2026-11-18T12:00:00Z",
};

type Answering = () => Response | Promise<Response>;

/** The hub's backend: each route answered by its own, the next in line first when a list. */
function stubHub(routes: {
  me?: Answering;
  account?: Answering | Answering[];
  reveal?: Answering | Answering[];
  revoke?: Answering | Answering[];
}) {
  const next = (route: Answering | Answering[] | undefined, name: string): Answering => {
    if (route === undefined) return () => Promise.reject(new Error(`no answer for ${name}`));
    if (!Array.isArray(route)) return route;
    return route.length > 1 ? (route.shift() as Answering) : (route[0] as Answering);
  };
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/hub/me" && method === "GET") {
      return (routes.me ?? (() => answer(200, SIGNED_IN)))();
    }
    if (url === "/api/hub/prices/account" && method === "GET") {
      return next(routes.account, "account")();
    }
    if (url === "/api/hub/prices/key/reveal" && method === "POST") {
      return next(routes.reveal, "reveal")();
    }
    if (url === "/api/hub/prices/key/revoke" && method === "POST") {
      return next(routes.revoke, "revoke")();
    }
    throw new Error(`unexpected request: ${method} ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Every request the page made, as `METHOD url`. */
const requests = (fetchMock: ReturnType<typeof stubHub>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The dashboard card titled `title`, once the tab has the account's answer. */
const card = async (title: string | RegExp) => {
  await screen.findByRole("tabpanel", { name: "Prices API" });
  await waitFor(() => expect(screen.queryByText("Checking for your API key…")).toBeNull());
  return (await screen.findByRole("heading", { level: 2, name: title })).closest(
    "section",
  ) as HTMLElement;
};

/** The card's text once its heading is taken out. */
const body = (section: HTMLElement) =>
  (section.textContent ?? "").replace(within(section).getByRole("heading").textContent ?? "", "");

beforeEach(() => {
  where = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the Prices tab", () => {
  it("offers Get API Key where there is no key: a form posting product=prices to the hub", async () => {
    const fetchMock = stubHub({ account: () => answer(200, NO_KEY) });
    renderAt("/api/dashboard/prices");
    const panel = await screen.findByRole("tabpanel", { name: "Prices API" });
    const button = await within(panel).findByRole("button", { name: "Get API Key" });
    expect(button.getAttribute("type")).toBe("submit");
    const form = button.closest("form") as HTMLFormElement;
    // A real form: the issue is a top-level navigation through Discord, and the backend reads the
    // product from an urlencoded body only.
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/hub/auth/issue");
    expect(form.getAttribute("enctype")).toBeNull();
    expect([...new FormData(form).entries()]).toEqual([["product", "prices"]]);

    const key = await card("API Key");
    expect(within(key).getByText("Not issued")).toBeTruthy();
    expect(within(key).getByTestId("no-key-notice").textContent).toBe(
      "No API key found for your account. If you contact us, quote your Discord ID 80351110224678912.",
    );
    expect(within(key).queryByTestId("api-key")).toBeNull();
    // The frame's empty tiles: nothing competes with the one action.
    expect(body(await card("Monthly Usage"))).toBe("");
    expect(body(await card("Rate Limit"))).toBe("");
    // Nothing is revealed, issued or revoked by opening the tab.
    expect(requests(fetchMock)).toEqual(["GET /api/hub/me", "GET /api/hub/prices/account"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/prices/account",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  // akot, 2026-11-18: the button at its own width, content and padding as the Prices pages' other
  // primary buttons have it, centred in the card, not a bar the card's width. jsdom lays nothing
  // out, so what is pinned is the style that gives it: no full width, and a form that centres it.
  it.each([
    ["no key", NO_KEY],
    ["a revoked key whose cap has passed", REVOKED_OPEN],
  ])("centres Get API Key at its own width, for %s", async (_, account) => {
    stubHub({ account: () => answer(200, account) });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    const button = within(key).getByRole("button", { name: "Get API Key" });
    expect(button.classList.contains("MuiButton-fullWidth")).toBe(false);
    expect(getComputedStyle(button).width).not.toBe("100%");
    const form = button.closest("form") as HTMLFormElement;
    expect(getComputedStyle(form).display).toBe("flex");
    expect(getComputedStyle(form).justifyContent).toBe("center");
  });

  it("shows an active key masked, with its id, dates and account, as the Prices dashboard does", async () => {
    const fetchMock = stubHub({ account: () => answer(200, ACTIVE) });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    expect(within(key).getByText("Just issued")).toBeTruthy();
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    expect(within(key).getByText("jfgkw6r9na")).toBeTruthy();
    // Issued and Last updated.
    expect(within(key).getAllByText("2 September 2026")).toHaveLength(2);
    expect(within(key).getByText("nelly").getAttribute("title")).toBe("80351110224678912");
    // The quota-period strip, dated by the plan's own reset.
    expect(within(key).getByRole("note").textContent).toBe(
      "!Regenerating is limited to once per quota period and issues nothing now. A new key can be issued from: 1 December 2026",
    );
    expect(within(key).queryByRole("button", { name: "Get API Key" })).toBeNull();
    // The value is asked for only when the visitor asks to see or copy it.
    expect(requests(fetchMock)).not.toContain("POST /api/hub/prices/key/reveal");
  });

  it("asks the hub for the key on Show key, once, and hides it again", async () => {
    const fetchMock = stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(200, REVEALED),
    });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(KEY_VALUE);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/prices/key/reveal",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );

    fireEvent.click(within(key).getByRole("button", { name: "Hide key" }));
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(KEY_VALUE);
    expect(requests(fetchMock).filter((r) => r.endsWith("/key/reveal"))).toHaveLength(1);
  });

  it("copies the key it asks the hub for, leaving it masked on screen, where ClipboardItem is missing", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubHub({ account: () => answer(200, ACTIVE), reveal: () => answer(200, REVEALED) });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
    await settle();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(KEY_VALUE);
    expect(within(key).getByRole("status").textContent).toBe("Copied.");
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
  });

  describe("where ClipboardItem is there", () => {
    /** The browser's clipboard, as WebKit has it: a write is let through only from the press. */
    function stubClipboard(write: (text: Promise<Blob>) => Promise<void> = async () => {}) {
      class ClipboardItem {
        constructor(readonly items: Record<string, Promise<Blob>>) {}
      }
      vi.stubGlobal("ClipboardItem", ClipboardItem);
      const clipboard = {
        write: vi.fn(([item]: ClipboardItem[]) => write(item.items["text/plain"])),
        writeText: vi.fn(() => Promise.resolve()),
      };
      vi.stubGlobal("navigator", { ...navigator, clipboard });
      return clipboard;
    }

    it("starts the write within the press, the key to come with the hub's answer", async () => {
      const written: string[] = [];
      const clipboard = stubClipboard(async (text) => {
        written.push(await (await text).text());
      });
      let answerReveal: (response: Response) => void = () => {};
      const fetchMock = stubHub({
        account: () => answer(200, ACTIVE),
        reveal: () => new Promise<Response>((resolve) => (answerReveal = resolve)),
      });
      renderAt("/api/dashboard/prices");
      const key = await card("API Key");
      fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
      // Before the hub has answered: WebKit refuses a write that starts after the press.
      expect(clipboard.write).toHaveBeenCalledOnce();
      expect(written).toEqual([]);

      answerReveal(answer(200, REVEALED));
      await settle();
      expect(written).toEqual([KEY_VALUE]);
      expect(clipboard.writeText).not.toHaveBeenCalled();
      expect(within(key).getByRole("status").textContent).toBe("Copied.");
      expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
      expect(requests(fetchMock).filter((r) => r.endsWith("/key/reveal"))).toHaveLength(1);
    });

    it("writes a key already shown within the press, without asking the hub again", async () => {
      const clipboard = stubClipboard();
      const fetchMock = stubHub({
        account: () => answer(200, ACTIVE),
        reveal: () => answer(200, REVEALED),
      });
      renderAt("/api/dashboard/prices");
      const key = await card("API Key");
      fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
      await settle();
      fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
      expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(KEY_VALUE);
      await settle();
      expect(within(key).getByRole("status").textContent).toBe("Copied.");
      expect(requests(fetchMock).filter((r) => r.endsWith("/key/reveal"))).toHaveLength(1);
    });

    it("says why the key can't be had when the hub fails, and not that the copy did", async () => {
      stubClipboard(async (text) => {
        await text;
      });
      stubHub({
        account: () => answer(200, ACTIVE),
        reveal: () => answer(502, { error: "prices_unavailable" }),
      });
      renderAt("/api/dashboard/prices");
      const key = await card("API Key");
      fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
      await settle();
      expect(within(key).getByTestId("reveal-failed").textContent).toBe(
        "Could not show your API key: the Prices API did not answer — try again in a moment (prices_unavailable).",
      );
      expect(within(key).queryByText(/Could not copy/)).toBeNull();
      expect(within(key).queryByRole("status")).toBeNull();
    });

    it("writes the key once the hub gives it where ClipboardItem takes no promise", async () => {
      const clipboard = stubClipboard();
      vi.stubGlobal(
        "ClipboardItem",
        class {
          constructor() {
            throw new TypeError("a promise is not a Blob");
          }
        },
      );
      const fetchMock = stubHub({
        account: () => answer(200, ACTIVE),
        reveal: () => answer(200, REVEALED),
      });
      renderAt("/api/dashboard/prices");
      const key = await card("API Key");
      fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
      await settle();
      expect(clipboard.write).not.toHaveBeenCalled();
      expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(KEY_VALUE);
      expect(within(key).getByRole("status").textContent).toBe("Copied.");
      expect(requests(fetchMock).filter((r) => r.endsWith("/key/reveal"))).toHaveLength(1);
    });

    it("says the copy failed when the browser refuses it", async () => {
      stubClipboard(() => Promise.reject(new DOMException("refused", "NotAllowedError")));
      stubHub({ account: () => answer(200, ACTIVE), reveal: () => answer(200, REVEALED) });
      renderAt("/api/dashboard/prices");
      const key = await card("API Key");
      fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
      await settle();
      expect(within(key).getByRole("alert").textContent).toBe(
        "Could not copy your API key: Could not copy — reveal the key and copy it by hand.",
      );
      expect(within(key).queryByRole("status")).toBeNull();
      expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    });
  });

  it("says why the key can't be shown when the hub fails, and keeps it masked", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(502, { error: "prices_unavailable" }),
    });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    expect(within(key).getByRole("alert")).toBe(within(key).getByTestId("reveal-failed"));
    expect(within(key).getByTestId("reveal-failed").textContent).toBe(
      "Could not show your API key: the Prices API did not answer — try again in a moment (prices_unavailable).",
    );
  });

  it("reads the account again when the key it asks for is gone", async () => {
    const fetchMock = stubHub({
      account: [() => answer(200, ACTIVE), () => answer(200, NO_KEY)],
      reveal: () => answer(409, { error: "no_key" }),
    });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await screen.findByRole("button", { name: "Get API Key" });
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it("regenerates through Prices' dialog: the typed phrase, then the hub's revoke", async () => {
    // Five seconds after the revocation's instant, as the hub would answer it: whether a new key
    // can be had yet, and the deactivation's tense, are read off the clock. Only `Date` is fixed.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T12:00:05Z"));
    const fetchMock = stubHub({
      account: () => answer(200, ACTIVE),
      revoke: () => answer(200, REVOCATION),
    });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Regenerate" }));
    const dialog = screen.getByRole("dialog", { name: "Regenerate API key?" });
    expect(within(dialog).getByTestId("replace-key-warning").textContent).toMatch(
      /regenerating is limited to once per quota period, and no new key is issued now/,
    );
    const confirm = within(dialog).getByTestId("replace-key-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId("replace-key-phrase"), {
      target: { value: "regenerate-key" },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/prices/key/revoke",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(key).queryByTestId("api-key")).toBeNull();
    expect(within(key).getByTestId("revoked-at").textContent).toBe("18 November 2026, 12:00 UTC");
    expect(within(key).getByTestId("key-revoked").textContent).toMatch(
      /It stops working within about half a minute of that instant — until then treat it as live/,
    );
    expect(within(key).getByTestId("key-cap").textContent).toBe(
      "You can generate a new key from 1 December 2026. Until then you do not have a working key.",
    );
    expect(within(key).queryByRole("button", { name: "Get API Key" })).toBeNull();
    // No key, so nothing is "Active".
    expect(body(await card("Rate Limit"))).toBe("");
  });

  it("keeps the dialog open and says so when the revoke isn't confirmed", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      revoke: () => answer(503, { error: "prices_busy" }),
    });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    fireEvent.click(within(key).getByRole("button", { name: "Regenerate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByTestId("replace-key-phrase"), {
      target: { value: "regenerate-key" },
    });
    fireEvent.click(within(dialog).getByTestId("replace-key-confirm"));
    await settle();
    expect(within(dialog).getByTestId("replace-key-failed").textContent).toMatch(
      /^Could not confirm the deactivation — your key may or may not have been switched off: the Prices API is busy right now — try again in a moment \(prices_busy\)\./,
    );
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
  });

  it("shows the account's usage and its plan's rate limit from the account's details", async () => {
    stubHub({ account: () => answer(200, ACTIVE) });
    renderAt("/api/dashboard/prices");
    const usage = await card("Monthly Usage");
    expect(within(usage).getByTestId("usage-used").textContent).toBe("42180");
    expect(within(usage).getByTestId("usage-limit").textContent).toBe("100000");
    expect(within(usage).getByTestId("usage-remaining").textContent).toBe("57820");
    expect(usage.textContent).toMatch(/42% used/);
    expect(usage.textContent).toMatch(/Resets 1 December/);
    expect(within(usage).getByTestId("usage-as-of").textContent).toMatch(
      /^Last updated Wed, 18 Nov 2026 12:00:00 UTC/,
    );

    const rate = await card("Rate Limit");
    expect(within(rate).getByText("Active")).toBeTruthy();
    expect(within(rate).getByText("Lite")).toBeTruthy();
    expect(within(rate).getByTestId("rate-limit").textContent).toBe("10");
    expect(rate.textContent).toMatch(/Per-minute limit600req\/min/);
    expect(rate.textContent).toMatch(/Response on throttleHTTP 429/);
    expect(rate.textContent).toMatch(/Response on missing keyHTTP 403/);
    expect(within(rate).getByTestId("rate-limit-contact").textContent).toBe(
      "Need more? Contact us to change your plan.",
    );
  });

  // The hub's contract: `usage: null` beside a working key is a usage read that failed. A key with
  // nothing counted yet comes with Prices' usage all the same, its `used` null.
  it.each([
    ["a plain visit", "", "API Key"],
    ["the visit after an issue", "?issue=issued", "Your API Key is ready"],
  ])("says a working key's usage couldn't be read when the account brings none, on %s", async (_, query, title) => {
    stubHub({ account: () => answer(200, { ...ACTIVE, details: details(null) }) });
    renderAt(`/api/dashboard/prices${query}`);
    await card(title);
    const usage = await card("Monthly Usage");
    expect(body(usage)).toBe("Could not load your usage.");
    expect(screen.getByRole("alert")).toBe(within(usage).getByTestId("usage-failed"));
    const rate = await card("Rate Limit");
    expect(within(rate).getByTestId("rate-limit-pending").textContent).toBe(
      "Could not load your plan, so its limits are not shown.",
    );
    expect(within(rate).queryByText("Active")).toBeNull();
    expect(screen.queryByText(/Your key is new/)).toBeNull();
  });

  it("says a key just issued that isn't listed yet has its usage to come, and states no limit", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    renderAt("/api/dashboard/prices?issue=issued");
    await screen.findByTestId("issue-settling");
    expect(body(await card("Monthly Usage"))).toBe(
      "Your key is new — usage figures appear here with a delay after your first requests.",
    );
    const rate = await card("Rate Limit");
    expect(within(rate).getByTestId("rate-limit-pending").textContent).toBe(
      "Your plan's limits appear here once your usage has loaded.",
    );
    expect(within(rate).queryByText("Active")).toBeNull();
  });

  it("states the cap's date and offers no key when the key was revoked this period", async () => {
    stubHub({ account: () => answer(200, REVOKED_CAPPED) });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    expect(within(key).getByText("Revoked")).toBeTruthy();
    expect(within(key).getByTestId("revoked-at").textContent).toBe("10 November 2026, 09:00 UTC");
    expect(within(key).getByTestId("key-cap").textContent).toBe(
      "You can generate a new key from 1 December 2026. Until then you do not have a working key.",
    );
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
    // The account's use this period is still its own; the revoked key has no limit to state.
    expect(within(await card("Monthly Usage")).getByTestId("usage-used").textContent).toBe("42180");
    expect(body(await card("Rate Limit"))).toBe("");
  });

  it("offers Get API Key again once the cap has passed", async () => {
    stubHub({ account: () => answer(200, REVOKED_OPEN) });
    renderAt("/api/dashboard/prices");
    const key = await card("API Key");
    expect(within(key).getByTestId("key-can-issue").textContent).toBe("A new key can be issued now.");
    const form = within(key).getByRole("button", { name: "Get API Key" }).closest("form");
    expect(form?.getAttribute("action")).toBe("/api/hub/auth/issue");
    expect(within(key).queryByTestId("key-cap")).toBeNull();
    expect(body(await card("Monthly Usage"))).toBe(
      "Your key was deactivated; there is no usage to show for it.",
    );
  });

  // Prices' words where it has them (`ApiKey` in `src/prices/app/app.tsx`); the "try again" there
  // was a link into the issue, here the Get API Key button under the banner.
  it.each([
    [
      "issued",
      ACTIVE,
      "issue-issued",
      "status",
      "Welcome! Your API key has been generated. Copy it below and make your first request — the Quick Start guide has everything you need.",
    ],
    [
      "has_key",
      ACTIVE,
      "issue-has-key",
      "status",
      "You already have an API key, so no new one was issued: it is below.",
    ],
    [
      "capped",
      REVOKED_CAPPED,
      "issue-capped",
      "alert",
      "No new key yet: you deactivated your previous key this quota period, and a replacement can be issued from 1 December 2026. Until then you do not have a working key.",
    ],
    [
      "too_young",
      NO_KEY,
      "issue-too-young",
      "alert",
      "Your Discord account is too new to get an API key — this is a short wait, not a rejection. Try again in a few minutes.",
    ],
    [
      "not_member",
      NO_KEY,
      "issue-not-member",
      "alert",
      "You need to be a member of the Stellar Developers Discord to get an API key — joining is an open invite. Once you are in, try again.",
    ],
    [
      "pending_rules",
      NO_KEY,
      "issue-pending-rules",
      "alert",
      "Your Discord account is on the Stellar Developers Discord, but you have not accepted the server's rules yet. Accept them on Discord, then try again.",
    ],
    [
      "unknown",
      NO_KEY,
      "issue-unknown",
      "alert",
      "We could not verify your Discord membership just now — that is a problem talking to Discord, not a statement about your membership. Please try again shortly.",
    ],
    [
      "failed",
      NO_KEY,
      "issue-failed",
      "alert",
      "We could not create your key. This is our key service, not your Discord membership. Please try again, and tell us if it keeps happening.",
    ],
    [
      "cancelled",
      NO_KEY,
      "issue-cancelled",
      "status",
      "You stopped before Discord could check your membership — nothing was created, and nothing is wrong. Pick it up again whenever you like.",
    ],
    [
      "account_mismatch",
      NO_KEY,
      "issue-account-mismatch",
      "alert",
      "Discord answered for another account than nelly, the one signed in here, so no key was issued. Switch back to nelly on Discord and try again, or sign out and sign in with the other account.",
    ],
  ])("says ?issue=%s in words, once, and takes it off the address", async (outcome, account, id, role, words) => {
    stubHub({ account: () => answer(200, account) });
    renderAt(`/api/dashboard/prices?issue=${outcome}&from=prices`);
    expect((await screen.findByTestId(id)).textContent).toBe(words);
    // Heard as well as seen: a key, or nothing wrong, as a status; a refusal as an alert.
    expect(screen.getByRole(role)).toBe(screen.getByTestId(id));
    await settle();
    expect(where).toBe("/dashboard/prices?from=prices");
    // Still on screen for this visit.
    expect(screen.getByTestId(id)).toBeTruthy();
  });

  it("names the key just issued, and links the quick start", async () => {
    stubHub({ account: () => answer(200, ACTIVE) });
    renderAt("/api/dashboard/prices?issue=issued");
    const key = await card("Your API Key is ready");
    expect(within(key).getByRole("button", { name: "Copy key" })).toBeTruthy();
    expect(within(key).getByRole("link", { name: /View quick start/ }).getAttribute("href")).toBe(
      "/api/quick-start/prices",
    );
    expect(within(key).queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("says a key just issued is on its way when the account doesn't list it yet", async () => {
    const fetchMock = stubHub({
      account: [() => answer(200, NO_KEY), () => answer(200, ACTIVE)],
    });
    renderAt("/api/dashboard/prices?issue=issued");
    const settling = await screen.findByTestId("issue-settling");
    expect(settling.textContent).toBe("Your key was created, and is taking a moment to appear. Check again");
    expect(screen.getByRole("status")).toBe(settling);
    // Not a second key for a visitor who has just been given one.
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
    expect(screen.queryByText("Not issued")).toBeNull();
    fireEvent.click(within(settling).getByRole("button", { name: "Check again" }));
    expect(await screen.findByTestId("api-key")).toBeTruthy();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  // The key was made before the browser came back: an account read that fails after it says only
  // that the key can't be shown yet, never that the issue failed.
  it("keeps saying the key was issued when the account can't be read, and shows it on Try again", async () => {
    stubHub({
      account: [() => answer(502, { error: "prices_unavailable" }), () => answer(200, ACTIVE)],
    });
    renderAt("/api/dashboard/prices?issue=issued");
    const failed = await screen.findByTestId("account-failed");
    expect(failed.textContent).toBe(
      "Could not load your Prices API key: the Prices API did not answer — try again in a moment (prices_unavailable).",
    );
    expect(screen.getByTestId("issue-issued").textContent).toMatch(
      /^Welcome! Your API key has been generated\./,
    );
    expect(screen.getByRole("status")).toBe(screen.getByTestId("issue-issued"));
    expect(screen.getByRole("alert")).toBe(failed);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const key = await card("Your API Key is ready");
    expect(within(key).getByTestId("issue-issued")).toBeTruthy();
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
  });

  it("shows no banner for an outcome it doesn't know, and takes it off the address", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    renderAt("/api/dashboard/prices?issue=bogus");
    await screen.findByRole("button", { name: "Get API Key" });
    await settle();
    expect(where).toBe("/dashboard/prices");
    expect(document.querySelector('[data-testid^="issue-"]')).toBeNull();
  });

  // Every error the hub's backend answers with, and what isn't its answer, in words: the code
  // stays beside them for a support message.
  it.each([
    [
      "503 product_not_configured",
      () => answer(503, { error: "product_not_configured" }),
      "the hub can't reach the Prices API on this server: its credentials for Prices are not available (product_not_configured)",
    ],
    [
      "502 prices_unavailable",
      () => answer(502, { error: "prices_unavailable" }),
      "the Prices API did not answer — try again in a moment (prices_unavailable)",
    ],
    [
      "503 prices_busy",
      () => answer(503, { error: "prices_busy" }),
      "the Prices API is busy right now — try again in a moment (prices_busy)",
    ],
    [
      "502 invalid_token",
      () => answer(502, { error: "invalid_token" }),
      "the Prices API refused the hub's request — this is ours to fix, so tell us if it keeps happening (invalid_token)",
    ],
    [
      "400 unknown_product",
      () => answer(400, { error: "unknown_product" }),
      "this server doesn't offer the Prices API tab (unknown_product)",
    ],
    [
      // The hub's own limit by address: the visitor's to wait out, not a fault to report.
      "429 rate_limited",
      () => answer(429, { error: "rate_limited" }),
      "too many requests — wait a minute and try again (rate_limited)",
    ],
    [
      "500 internal",
      () => answer(500, { error: "internal" }),
      "the hub failed — try again, and tell us if it keeps happening (internal)",
    ],
    [
      "Prices' own code",
      () => answer(503, { error: "key_unavailable" }),
      "the Prices API answered with an error — try again, and tell us if it keeps happening (key_unavailable)",
    ],
    [
      "the CDN's page, not JSON",
      () => new Response("<!doctype html>", { status: 200 }),
      "the hub answered in a way this page can't read — try again, and tell us if it keeps happening (unreadable)",
    ],
    [
      "a 403 page",
      () => new Response("<!doctype html>", { status: 403 }),
      "the hub answered in a way this page can't read — try again, and tell us if it keeps happening (unreadable)",
    ],
    [
      "an account it can't read",
      () => answer(200, { key: { state: "lost" } }),
      "the hub answered in a way this page can't read — try again, and tell us if it keeps happening (unreadable)",
    ],
    [
      "a key in a state it doesn't know",
      () => answer(200, { key: { state: "suspended", can_issue: true }, details: details(null) }),
      "the hub answered in a way this page can't read — try again, and tell us if it keeps happening (unreadable)",
    ],
    [
      "usage it can't read",
      () => answer(200, { ...ACTIVE, details: details("lots") }),
      "the hub answered in a way this page can't read — try again, and tell us if it keeps happening (unreadable)",
    ],
    [
      "no answer",
      () => Promise.reject(new TypeError("fetch failed")),
      "the hub could not be reached — check your connection and try again (unreachable)",
    ],
  ])("says %s in words, and tries again on Try again", async (_, failing, words) => {
    const fetchMock = stubHub({ account: [failing, () => answer(200, ACTIVE)] });
    renderAt("/api/dashboard/prices");
    const failed = await screen.findByTestId("account-failed");
    expect(failed.textContent).toBe(`Could not load your Prices API key: ${words}.`);
    // One alert: the usage card's failure is this one's.
    expect(screen.getByRole("alert")).toBe(failed);
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
    expect(within(await card("Rate Limit")).getByTestId("rate-limit-pending").textContent).toBe(
      "Could not load your plan, so its limits are not shown.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("api-key")).toBeTruthy();
    expect(screen.queryByTestId("account-failed")).toBeNull();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it("offers a fresh sign-in when the session has ended", async () => {
    stubHub({ account: () => answer(401, { error: "not_signed_in" }) });
    renderAt("/api/dashboard/prices");
    expect((await screen.findByTestId("account-failed")).textContent).toBe(
      "Could not load your Prices API key: your session has ended — sign in again (not_signed_in).",
    );
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      "/api/hub/auth/login",
    );
  });

  it("gives up on the hub after 30 seconds, and says so", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // `/me` answers; the account never does, until the page's signal gives up on it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url === "/api/hub/me") return answer(200, SIGNED_IN);
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        );
      }),
    );
    renderAt("/api/dashboard/prices");
    await act(() => vi.advanceTimersByTimeAsync(0));
    // Prices' words while the account is asked for.
    expect(screen.getByText("Checking for your API key…")).toBeTruthy();
    expect(screen.getByText("Loading your usage…")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(30_000 - 1));
    expect(screen.queryByTestId("account-failed")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByTestId("account-failed").textContent).toBe(
      "Could not load your Prices API key: the hub didn't answer within 30 seconds — try again (timeout).",
    );
  });
});

/**
 * "Get API Key" in a second window, as the sign-in is (akot, 2026-11-20). The window's watch and
 * its refusals are the x402 tab's tests (`../x402/X402Tab.spec.tsx`): one hook serves both tabs.
 */
describe("the Prices tab's Get API Key window", () => {
  const opens = (popup: unknown) =>
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const getKeyForm = async () =>
    (await screen.findByRole("button", { name: "Get API Key" })).closest("form") as HTMLFormElement;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the form to a second window, and takes the key it came back with", async () => {
    const fetchMock = stubHub({ account: [() => answer(200, NO_KEY), () => answer(200, ACTIVE)] });
    const open = opens({ closed: false, focus: vi.fn() });
    renderAt("/api/dashboard/prices");
    const form = await getKeyForm();
    expect(fireEvent.submit(form)).toBe(true);
    expect(open).toHaveBeenCalledWith("", "stellar-portal-oauth", expect.stringContaining("popup=yes"));
    expect(form.target).toBe("stellar-portal-oauth");
    expect([...new FormData(form).entries()]).toEqual([["product", "prices"]]);
    const button = within(form).getByRole("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Waiting for Discord…");
    expect(button.disabled).toBe(true);

    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { source: "stellar-portal-oauth", search: "?issue=issued" },
        }),
      );
    });
    expect(await screen.findByTestId("issue-issued")).toBeTruthy();
    expect(await card("Your API Key is ready")).toBeTruthy();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
    expect(where).toBe("/dashboard/prices");
  });

  // An account that has not accepted the server's rules is told so, whichever page the backend
  // left the window on (akot, 2026-11-20): never "We could not create your key".
  it.each(["?issue=pending_rules", "?signin=pending_rules"])(
    "says the rules are not accepted yet when the window lands with %s",
    async (search) => {
      stubHub({ account: () => answer(200, NO_KEY) });
      opens({ closed: false, focus: vi.fn() });
      renderAt("/api/dashboard/prices");
      fireEvent.submit(await getKeyForm());
      await act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            data: { source: "stellar-portal-oauth", search },
          }),
        );
      });
      expect((await screen.findByTestId("issue-pending-rules")).textContent).toBe(
        "Your Discord account is on the Stellar Developers Discord, but you have not accepted the server's rules yet. Accept them on Discord, then try again.",
      );
      expect(screen.queryByTestId("issue-failed")).toBeNull();
    },
  );

  it("is the plain form, posted in the tab, where the browser opens no window", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(null);
    renderAt("/api/dashboard/prices");
    const form = await getKeyForm();
    expect(fireEvent.submit(form)).toBe(true);
    expect(form.target).toBe("");
    expect((within(form).getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
