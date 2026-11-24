import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

/**
 * The dashboard's x402 tab, through the account pages' `App`, on the hub's backend in memory:
 * `/me` for the session and the three x402 routes the tab calls (`bff/src/products/client.ts`).
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
const KEY_VALUE = "x4_mHNVA7eOQ53h5UdLTVpSn2yjDizblKRQ62l61ko4";
const MASK = "••••••••••••••••••••••••••••••••";
const UNAVAILABLE = "x402 is unavailable right now. Try again in a moment.";
const NOT_VIEWABLE =
  "This key can't be shown again. Regenerate ends it; a new key can be issued from the next calendar month.";

const NO_KEY = { key: { state: "none", can_issue: true }, details: { showable: false } };
const ACTIVE = {
  key: { state: "active", key_id: "k_7f3a9c", created_at: "2026-09-02T10:00:00Z", can_issue: false },
  details: { showable: true },
};
const ACTIVE_UNSHOWABLE = { ...ACTIVE, details: { showable: false } };
const REVOKED_CAPPED = {
  key: {
    state: "revoked",
    revoked_at: "2026-11-10T09:00:00Z",
    next_eligible_at: "2026-12-01T00:00:00Z",
    can_issue: false,
  },
  details: { showable: false },
};
const REVOKED_OPEN = {
  key: { state: "revoked", revoked_at: "2026-10-10T09:00:00Z", can_issue: true },
  details: { showable: false },
};
/** x402's `details.usage`: a free account's payments on Mainnet this month, 312 of its 1,000. */
const USAGE = {
  used: 312,
  remaining: 688,
  limit: 1000,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  resets_at: "2026-12-01T00:00:00Z",
  as_of: "2026-11-24T12:00:00Z",
  plan: { name: "free", quota_limit: 1000, quota_period: "month" },
};
/** `account` with `usage` in its details, as an x402 with the account quota answers. */
const withUsage = <T extends { details: object }>(account: T, usage: unknown = USAGE) => ({
  ...account,
  details: { ...account.details, usage },
});
const REVEALED = { key_id: "k_7f3a9c", value: KEY_VALUE, created_at: "2026-09-02T10:00:00Z" };
const REVOCATION = {
  revoked: true,
  revoked_at: "2026-11-18T12:00:00Z",
  next_eligible_at: "2026-12-01T00:00:00Z",
};

type Answering = () => Response | Promise<Response>;

/** The hub's backend: each route answered by its own, the next in line first when a list. */
function stubHub(routes: {
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
    if (url === "/api/hub/me" && method === "GET") return answer(200, SIGNED_IN);
    if (url === "/api/hub/x402/account" && method === "GET") {
      return next(routes.account, "account")();
    }
    if (url === "/api/hub/x402/key/reveal" && method === "POST") {
      return next(routes.reveal, "reveal")();
    }
    if (url === "/api/hub/x402/key/revoke" && method === "POST") {
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

/** The "API Key" card, once the tab has the account's answer. */
const card = async () => {
  await screen.findByRole("tabpanel", { name: "x402" });
  await waitFor(() => expect(screen.queryByText("Checking for your API key…")).toBeNull());
  return (await screen.findByRole("heading", { level: 2, name: "API Key" })).closest(
    "section",
  ) as HTMLElement;
};

/** The dashboard card titled `title`, once the tab has the account's answer. */
const tile = async (title: string) => {
  await card();
  return (await screen.findByRole("heading", { level: 2, name: title })).closest(
    "section",
  ) as HTMLElement;
};

/** The card's text once its heading is taken out. */
const body = (section: HTMLElement) =>
  (section.textContent ?? "").replace(within(section).getByRole("heading").textContent ?? "", "");

beforeEach(() => {
  where = "";
  vi.stubEnv("VITE_PRODUCTS", "prices,x402");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the x402 tab", () => {
  it("offers Get API Key where there is no key: a form posting product=x402 to the hub", async () => {
    const fetchMock = stubHub({ account: () => answer(200, NO_KEY) });
    renderAt("/api/dashboard/x402");
    const panel = await screen.findByRole("tabpanel", { name: "x402" });
    const button = await within(panel).findByRole("button", { name: "Get API Key" });
    expect(button.getAttribute("type")).toBe("submit");
    const form = button.closest("form") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/hub/auth/issue");
    expect(form.getAttribute("enctype")).toBeNull();
    expect([...new FormData(form).entries()]).toEqual([["product", "x402"]]);

    const key = await card();
    expect(within(key).getByText("Not issued")).toBeTruthy();
    expect(within(key).queryByTestId("api-key")).toBeNull();
    // Nothing is revealed, issued or revoked by opening the tab.
    expect(requests(fetchMock)).toEqual(["GET /api/hub/me", "GET /api/hub/x402/account"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/x402/account",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  // No `usage` at all: an x402 older than its account quota, or an account without a key.
  it.each([
    ["an x402 that sends no usage", ACTIVE],
    ["no key", NO_KEY],
    ["no key, whatever usage comes with it", withUsage(NO_KEY)],
  ])("states the two networks in two tiles, and names no plan, usage or quota, for %s", async (_, account) => {
    stubHub({ account: () => answer(200, account) });
    renderAt("/api/dashboard/x402");
    await card();
    const pubnet = screen.getByRole("heading", { level: 2, name: "Mainnet (pubnet)" });
    expect(pubnet.closest("section")?.textContent).toMatch(
      /API key required on \/verify and \/settle$/,
    );
    const testnet = screen.getByRole("heading", { level: 2, name: "Testnet" });
    expect(testnet.closest("section")?.textContent).toMatch(/No API key needed$/);
    const panel = screen.getByRole("tabpanel", { name: "x402" });
    expect(panel.textContent).not.toMatch(/quota|usage|rate limit|plan/i);
  });

  // x402's count of the account's payments on Mainnet this month (`details.usage`): a revoked key's
  // account still has its month.
  it.each([
    ["an active key", withUsage(ACTIVE)],
    ["a revoked key", withUsage(REVOKED_CAPPED)],
  ])("shows the month's payments on Mainnet for %s: used of the limit, what is left, the reset and the plan", async (_, account) => {
    stubHub({ account: () => answer(200, account) });
    renderAt("/api/dashboard/x402");
    const usage = await tile("Monthly Usage · Mainnet");
    expect(within(usage).getByTestId("usage-used").textContent).toBe("312");
    expect(within(usage).getByTestId("usage-limit").textContent).toBe("1000");
    expect(usage.textContent).toMatch(/1,000 payments/);
    expect(within(usage).getByTestId("usage-remaining").textContent).toBe("688");
    expect(usage.textContent).toMatch(/31% used/);
    expect(usage.textContent).toMatch(/Resets 1 December/);
    expect(within(usage).getByText("Free")).toBeTruthy();
    // The facilitator's own count, so there is no reporting delay to state; and no quota reached.
    expect(usage.textContent).not.toMatch(/delay|last updated|requests/i);
    expect(within(usage).queryByTestId("usage-quota-reached")).toBeNull();
    // In the Mainnet tile's place; the Testnet one is as it was.
    expect(screen.queryByRole("heading", { level: 2, name: "Mainnet (pubnet)" })).toBeNull();
    const testnet = screen.getByRole("heading", { level: 2, name: "Testnet" });
    expect(testnet.closest("section")?.textContent).toBe("TestnetNo API key needed");
  });

  // At the quota, and past it: x402's count can pass the limit, and the strip stays.
  it.each([
    ["at", { used: 1000, remaining: 0 }],
    ["past", { used: 1004, remaining: 0 }],
  ])("says until when Mainnet /settle refuses, %s the quota", async (_, counts) => {
    stubHub({ account: () => answer(200, withUsage(ACTIVE, { ...USAGE, ...counts })) });
    renderAt("/api/dashboard/x402");
    const usage = await tile("Monthly Usage · Mainnet");
    const strip = within(usage).getByTestId("usage-quota-reached");
    expect(strip.textContent).toBe(
      "Monthly quota reached. Mainnet /settle refuses until 1 December. Contact us for a higher limit.",
    );
    const contact = within(strip).getByRole("link", { name: "Contact us for a higher limit." });
    expect(contact.getAttribute("href")).toBe("https://www.rumblefish.dev/contact/");
    expect(within(usage).getByTestId("usage-remaining").textContent).toBe("0");
    expect(usage.textContent).toMatch(/100% - limit reached/);
  });

  // `usage: null` is x402 failing to read the month; a usage the page can't read is the same.
  it.each([
    ["null", null],
    ["something that isn't an object", "lots"],
    ["a count that isn't a number", { ...USAGE, used: "312" }],
    ["a count below zero", { ...USAGE, remaining: -1 }],
    ["a count that isn't whole", { ...USAGE, limit: 1000.5 }],
    ["a limit of 0", { ...USAGE, used: 0, remaining: 0, limit: 0 }],
    ["no reset", { ...USAGE, resets_at: undefined }],
    ["a reset that isn't a date", { ...USAGE, resets_at: "soon" }],
    ["a reset that isn't RFC 3339", { ...USAGE, resets_at: "12/01/2026" }],
    ["a reset on a day that doesn't exist", { ...USAGE, resets_at: "2026-02-30T00:00:00Z" }],
    ["no plan", { ...USAGE, plan: undefined }],
    ["a plan without a name", { ...USAGE, plan: { ...USAGE.plan, name: "" } }],
    ["a quota that isn't a month's", { ...USAGE, plan: { ...USAGE.plan, quota_period: "week" } }],
  ])("says the usage could not be loaded when x402 sends %s", async (_, usage) => {
    stubHub({ account: () => answer(200, withUsage(ACTIVE, usage)) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    const failed = await tile("Monthly Usage · Mainnet");
    expect(body(failed)).toBe("Could not load your usage.");
    // The page's one failure: the key itself was read.
    expect(screen.getByRole("alert")).toBe(within(failed).getByTestId("usage-failed"));
    expect(within(key).getByText("Active")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Mainnet (pubnet)" })).toBeNull();
  });

  // Until the account is read there is no month to show: the Mainnet tile is true for everyone.
  it("keeps the Mainnet tile while the account is asked for, then shows the month", async () => {
    let answerAccount: (response: Response) => void = () => {};
    stubHub({ account: () => new Promise<Response>((resolve) => (answerAccount = resolve)) });
    renderAt("/api/dashboard/x402");
    await screen.findByText("Checking for your API key…");
    const pubnet = await screen.findByRole("heading", { level: 2, name: "Mainnet (pubnet)" });
    expect(body(pubnet.closest("section") as HTMLElement)).toBe(
      "API key required on /verify and /settle",
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Monthly Usage · Mainnet" })).toBeNull();
    answerAccount(answer(200, withUsage(ACTIVE)));
    const usage = await tile("Monthly Usage · Mainnet");
    expect(within(usage).getByTestId("usage-used").textContent).toBe("312");
  });

  // A failed read is the key card's to say; the Mainnet tile stays as it was.
  it("keeps the Mainnet tile when the account can't be read", async () => {
    stubHub({ account: () => answer(502, { error: "x402_unavailable" }) });
    renderAt("/api/dashboard/x402");
    const failed = await screen.findByTestId("account-failed");
    expect(screen.getByRole("alert")).toBe(failed);
    const pubnet = screen.getByRole("heading", { level: 2, name: "Mainnet (pubnet)" });
    expect(body(pubnet.closest("section") as HTMLElement)).toBe(
      "API key required on /verify and /settle",
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Monthly Usage · Mainnet" })).toBeNull();
    expect(screen.queryByTestId("usage-failed")).toBeNull();
  });

  it("shows an active key masked, with its id, issue date and account, and the month's rule", async () => {
    const fetchMock = stubHub({ account: () => answer(200, ACTIVE) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    expect(within(key).getByText("Active")).toBeTruthy();
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    expect(within(key).getByText("k_7f3a9c")).toBeTruthy();
    expect(within(key).getByText("2 September 2026")).toBeTruthy();
    expect(within(key).getByText("nelly").getAttribute("title")).toBe("80351110224678912");
    expect(within(key).getByRole("note").textContent).toBe(
      "!Regenerating is limited to once per calendar month and issues nothing now.",
    );
    expect(within(key).queryByRole("button", { name: "Get API Key" })).toBeNull();
    expect(within(key).queryByText(NOT_VIEWABLE)).toBeNull();
    // The value is asked for only when the visitor asks to see or copy it.
    expect(requests(fetchMock)).not.toContain("POST /api/hub/x402/key/reveal");
  });

  it("asks the hub for the key on Show key, once, and hides it again, keeping it off storage", async () => {
    const fetchMock = stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(200, REVEALED),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(KEY_VALUE);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/x402/key/reveal",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY_VALUE);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(KEY_VALUE);
    expect(where).not.toContain(KEY_VALUE);

    fireEvent.click(within(key).getByRole("button", { name: "Hide key" }));
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    expect(document.body.textContent).not.toContain(KEY_VALUE);
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(KEY_VALUE);
    expect(requests(fetchMock).filter((r) => r.endsWith("/key/reveal"))).toHaveLength(1);
  });

  it("shows no part of the key after it is revoked: the value is nowhere on the page", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(200, REVEALED),
      revoke: () => answer(200, REVOCATION),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(document.body.textContent).toContain(KEY_VALUE);
    fireEvent.click(within(key).getByRole("button", { name: "Regenerate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByTestId("replace-key-phrase"), {
      target: { value: "regenerate-key" },
    });
    fireEvent.click(within(dialog).getByTestId("replace-key-confirm"));
    await settle();
    expect(within(key).getByText("Revoked")).toBeTruthy();
    expect(document.body.textContent).not.toContain(KEY_VALUE);
  });

  it("does not read the account again for a reveal that says no_key after the tab is gone", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let answerReveal: (response: Response) => void = () => {};
    const fetchMock = stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => new Promise<Response>((resolve) => (answerReveal = resolve)),
    });
    const { unmount } = renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    unmount();
    answerReveal(answer(409, { error: "no_key" }));
    await settle();
    // The answer would have the account read again, were the tab still there to act on it.
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("copies the key it asks the hub for, leaving it masked on screen", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubHub({ account: () => answer(200, ACTIVE), reveal: () => answer(200, REVEALED) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
    await settle();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(KEY_VALUE);
    expect(within(key).getByRole("status").textContent).toBe("Copied.");
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
  });

  it("starts the clipboard write within the press where ClipboardItem is there", async () => {
    const written: string[] = [];
    class ClipboardItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItem);
    const clipboard = {
      write: vi.fn(async ([item]: ClipboardItem[]) => {
        written.push(await (await item.items["text/plain"]).text());
      }),
      writeText: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    stubHub({ account: () => answer(200, ACTIVE), reveal: () => answer(200, REVEALED) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Copy key" }));
    expect(clipboard.write).toHaveBeenCalledOnce();
    await settle();
    expect(written).toEqual([KEY_VALUE]);
    expect(within(key).getByRole("status").textContent).toBe("Copied.");
  });

  it("offers neither Show nor Copy for a key that can't be shown, and says why", async () => {
    const fetchMock = stubHub({ account: () => answer(200, ACTIVE_UNSHOWABLE) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    expect(within(key).queryByRole("button", { name: "Show key" })).toBeNull();
    expect(within(key).queryByRole("button", { name: "Copy key" })).toBeNull();
    expect(within(key).getByText(NOT_VIEWABLE)).toBeTruthy();
    expect(within(key).getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(requests(fetchMock)).not.toContain("POST /api/hub/x402/key/reveal");
  });

  it("says the key can't be shown when reveal answers 409 key_not_viewable", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(409, { error: "key_not_viewable" }),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByText(NOT_VIEWABLE)).toBeTruthy();
    expect(within(key).queryByRole("button", { name: "Show key" })).toBeNull();
    expect(within(key).queryByRole("button", { name: "Copy key" })).toBeNull();
    expect(within(key).queryByTestId("reveal-failed")).toBeNull();
  });

  it("says why the key can't be shown when the hub fails, and keeps it masked", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      reveal: () => answer(502, { error: "x402_unavailable" }),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
    expect(within(key).getByRole("alert")).toBe(within(key).getByTestId("reveal-failed"));
    expect(within(key).getByTestId("reveal-failed").textContent).toBe(
      `Could not show your API key: ${UNAVAILABLE.slice(0, -1)} (x402_unavailable).`,
    );
  });

  it("reads the account again when the key it asks for is gone", async () => {
    const fetchMock = stubHub({
      account: [() => answer(200, ACTIVE), () => answer(200, NO_KEY)],
      reveal: () => answer(409, { error: "no_key" }),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await screen.findByRole("button", { name: "Get API Key" });
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it("regenerates behind the typed phrase: the hub's revoke, then the revoked state with its date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T12:00:05Z"));
    const fetchMock = stubHub({
      account: () => answer(200, ACTIVE),
      revoke: () => answer(200, REVOCATION),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Regenerate" }));
    const dialog = screen.getByRole("dialog", { name: "Regenerate API key?" });
    const warning = within(dialog).getByTestId("replace-key-warning").textContent ?? "";
    expect(warning).toMatch(/limited to once per calendar month, and no new key is issued now/);
    expect(warning).not.toMatch(/quota|AWS/i);
    const confirm = within(dialog).getByTestId("replace-key-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId("replace-key-phrase"), {
      target: { value: "regenerate-key" },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/x402/key/revoke",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    // It revokes and issues nothing.
    expect(requests(fetchMock).filter((r) => r.includes("issue"))).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(key).queryByTestId("api-key")).toBeNull();
    expect(within(key).getByText("Revoked")).toBeTruthy();
    expect(within(key).getByTestId("key-revoked").textContent).toBe(
      "Your key was revoked on 18 November 2026. A new key can be issued from 1 December 2026.",
    );
    expect(within(key).queryByRole("button", { name: "Get API Key" })).toBeNull();
  });

  it("keeps the dialog open and says so when the revoke isn't confirmed", async () => {
    stubHub({
      account: () => answer(200, ACTIVE),
      revoke: () => answer(503, { error: "x402_busy" }),
    });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Regenerate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByTestId("replace-key-phrase"), {
      target: { value: "regenerate-key" },
    });
    fireEvent.click(within(dialog).getByTestId("replace-key-confirm"));
    await settle();
    expect(within(dialog).getByTestId("replace-key-failed").textContent).toMatch(
      /^Could not confirm the revocation — your key may or may not have been switched off: x402 is unavailable right now\. Try again in a moment \(x402_busy\)\./,
    );
    expect(within(key).getByTestId("api-key").textContent).toBe(MASK);
  });

  it("states the date and offers no key when the key was revoked this month", async () => {
    stubHub({ account: () => answer(200, REVOKED_CAPPED) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    expect(within(key).getByText("Revoked")).toBeTruthy();
    expect(within(key).getByTestId("key-revoked").textContent).toBe(
      "Your key was revoked on 10 November 2026. A new key can be issued from 1 December 2026.",
    );
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
  });

  it("offers Get API Key again for a key revoked in an earlier month", async () => {
    stubHub({ account: () => answer(200, REVOKED_OPEN) });
    renderAt("/api/dashboard/x402");
    const key = await card();
    expect(within(key).getByTestId("key-revoked").textContent).toMatch(
      /^Your key was revoked on 10 October 2026\./,
    );
    const button = within(key).getByRole("button", { name: "Get API Key" });
    const form = button.closest("form") as HTMLFormElement;
    expect([...new FormData(form).entries()]).toEqual([["product", "x402"]]);
  });

  // Prices' words for each outcome, with "calendar month" where it says "quota period".
  it.each([
    [
      "issued",
      ACTIVE,
      "issue-issued",
      "status",
      "Your API key is ready. Show or copy it below.",
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
      "No new key yet: you deactivated your previous key this calendar month, and a replacement can be issued from 1 December 2026. Until then you do not have a working key.",
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
      "failed",
      NO_KEY,
      "issue-failed",
      "alert",
      "We could not create your key. This is our key service, not your Discord membership. Please try again, and tell us if it keeps happening.",
    ],
  ])("says ?issue=%s in words, once, and takes it off the address", async (outcome, account, id, role, words) => {
    stubHub({ account: () => answer(200, account) });
    renderAt(`/api/dashboard/x402?issue=${outcome}&from=x402`);
    expect((await screen.findByTestId(id)).textContent).toBe(words);
    expect(screen.getByRole(role)).toBe(screen.getByTestId(id));
    await settle();
    expect(where).toBe("/dashboard/x402?from=x402");
    expect(screen.getByTestId(id)).toBeTruthy();
  });

  it("says a key just issued that isn't listed yet is on its way, and offers no second key", async () => {
    const fetchMock = stubHub({
      account: [() => answer(200, NO_KEY), () => answer(200, ACTIVE)],
    });
    renderAt("/api/dashboard/x402?issue=issued");
    const settling = await screen.findByTestId("issue-settling");
    expect(screen.getByRole("status")).toBe(settling);
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();
    fireEvent.click(within(settling).getByRole("button", { name: "Check again" }));
    expect(await screen.findByTestId("api-key")).toBeTruthy();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it("shows no banner for an outcome it doesn't know, and takes it off the address", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    renderAt("/api/dashboard/x402?issue=bogus");
    await screen.findByRole("button", { name: "Get API Key" });
    await settle();
    expect(where).toBe("/dashboard/x402");
    expect(document.querySelector('[data-testid^="issue-"]')).toBeNull();
  });

  // The hub's x402 failures, and what isn't its answer, as the one line, with a way to try again.
  it.each([
    ["502 x402_unavailable", () => answer(502, { error: "x402_unavailable" })],
    ["503 x402_busy", () => answer(503, { error: "x402_busy" })],
    // x402's own: its key store out of reach, passed on by the hub under x402's status.
    ["502 key_unavailable", () => answer(502, { error: "key_unavailable" })],
    ["503 product_not_configured", () => answer(503, { error: "product_not_configured" })],
    ["400 unknown_product", () => answer(400, { error: "unknown_product" })],
    ["a 200 that isn't JSON", () => new Response("<!doctype html>", { status: 200 })],
    ["an account it can't read", () => answer(200, { key: { state: "lost" } })],
    ["no answer", () => Promise.reject(new TypeError("fetch failed"))],
  ])("says %s as x402 being unavailable, and tries again on Try again", async (_, failing) => {
    const fetchMock = stubHub({ account: [failing, () => answer(200, ACTIVE)] });
    renderAt("/api/dashboard/x402");
    const failed = await screen.findByTestId("account-failed");
    expect(failed.textContent).toBe(UNAVAILABLE);
    expect(screen.getByRole("alert")).toBe(failed);
    expect(screen.queryByRole("button", { name: "Get API Key" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("api-key")).toBeTruthy();
    expect(screen.queryByTestId("account-failed")).toBeNull();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it.each([
    [
      "429 rate_limited",
      answer(429, { error: "rate_limited" }),
      "too many requests — wait a minute and try again (rate_limited)",
    ],
    [
      "502 invalid_token",
      answer(502, { error: "invalid_token" }),
      "x402 refused the hub's request — this is ours to fix, so tell us if it keeps happening (invalid_token)",
    ],
  ])("says %s in its own words on a failed reveal", async (_, failing, words) => {
    stubHub({ account: () => answer(200, ACTIVE), reveal: () => failing.clone() });
    renderAt("/api/dashboard/x402");
    const key = await card();
    fireEvent.click(within(key).getByRole("button", { name: "Show key" }));
    await settle();
    expect(within(key).getByTestId("reveal-failed").textContent).toBe(
      `Could not show your API key: ${words}.`,
    );
  });

  it("offers a fresh sign-in when the session has ended", async () => {
    stubHub({ account: () => answer(401, { error: "not_signed_in" }) });
    renderAt("/api/dashboard/x402");
    expect((await screen.findByTestId("account-failed")).textContent).toBe(
      "Your session has ended. Sign in again to see your x402 API key.",
    );
    // To the dashboard's own sign-in page, under the router's basename.
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      "/api/login",
    );
  });
});

/**
 * "Get API Key" in a second window, as the sign-in is (akot, 2026-11-20): the form's `POST` goes
 * to a window of its own, the tab stays, and takes the outcome from the window when it comes back.
 */
describe("the x402 tab's Get API Key window", () => {
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
  /** The form, once the card offers it. */
  const getKeyForm = async () =>
    (await screen.findByRole("button", { name: "Get API Key" })).closest("form") as HTMLFormElement;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the form to a second window and says it is waiting", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    const open = opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    const form = await getKeyForm();
    // The submit goes ahead: it is the form's own `POST`, with the window as its target.
    expect(fireEvent.submit(form)).toBe(true);
    expect(open).toHaveBeenCalledWith("", "stellar-portal-oauth", expect.stringContaining("popup=yes"));
    expect(form.target).toBe("stellar-portal-oauth");

    const button = within(form).getByRole("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Waiting for Discord…");
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("issue-waiting").getAttribute("role")).toBe("status");
    expect(where).toBe("/dashboard/x402");
  });

  it("takes the key the window came back with, and reads the account again", async () => {
    const fetchMock = stubHub({ account: [() => answer(200, NO_KEY), () => answer(200, ACTIVE)] });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    fireEvent.submit(await getKeyForm());
    await windowLands("?issue=issued");

    expect((await screen.findByTestId("issue-issued")).textContent).toBe(
      "Your API key is ready. Show or copy it below.",
    );
    expect(within(await card()).getByText("Active")).toBeTruthy();
    expect(screen.queryByTestId("issue-waiting")).toBeNull();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
    // The outcome came from the window, not the address: the tab went nowhere.
    expect(where).toBe("/dashboard/x402");
  });

  it("says the refusal the window came back with, and offers Get API Key again", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    fireEvent.submit(await getKeyForm());
    await windowLands("?issue=not_member");

    expect(await screen.findByTestId("issue-not-member")).toBeTruthy();
    const button = (await screen.findByRole("button", { name: "Get API Key" })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  // The window ended on the sign-in page: the backend could not tell the round trip was an issue
  // (its two halves outlived their 10 minutes, or its cookie was gone) and refused it as a
  // sign-in. The reason is said as the issue's own, never flattened to "we could not create your
  // key": an account that has not accepted the rules is told so (akot, 2026-11-20).
  it.each([
    ["pending_rules", "issue-pending-rules"],
    ["not_member", "issue-not-member"],
    ["unknown", "issue-unknown"],
    ["cancelled", "issue-cancelled"],
    ["failed", "issue-failed"],
    // The backend's limit on its sign-in routes, which refuses an issue's too.
    ["busy", "issue-busy"],
    // Not a reason the sign-in page has: no key was issued, and that is all that is known.
    ["issued", "issue-failed"],
    ["bogus", "issue-failed"],
  ])("says ?signin=%s from the window as %s", async (reason, testId) => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    fireEvent.submit(await getKeyForm());
    await windowLands(`?signin=${reason}`);
    expect(await screen.findByTestId(testId)).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="issue-"]')).toHaveLength(1);
  });

  it("says the rules are not accepted yet, in the banner's own words", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    fireEvent.submit(await getKeyForm());
    await windowLands("?issue=pending_rules");
    expect((await screen.findByTestId("issue-pending-rules")).textContent).toBe(
      "Your Discord account is on the Stellar Developers Discord, but you have not accepted the server's rules yet. Accept them on Discord, then try again.",
    );
    expect(screen.queryByTestId("issue-failed")).toBeNull();
  });

  it("has the window's outcome stand in for the one the address came with", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402?issue=cancelled");
    expect(await screen.findByTestId("issue-cancelled")).toBeTruthy();
    fireEvent.submit(await getKeyForm());
    expect(screen.queryByTestId("issue-cancelled")).toBeNull();
    await windowLands("?issue=too_young");
    expect(await screen.findByTestId("issue-too-young")).toBeTruthy();
    expect(screen.queryByTestId("issue-cancelled")).toBeNull();
  });

  it("is the plain form, posted in the tab, where the browser opens no window", async () => {
    stubHub({ account: () => answer(200, NO_KEY) });
    opens(null);
    renderAt("/api/dashboard/x402");
    const form = await getKeyForm();
    expect(fireEvent.submit(form)).toBe(true);
    expect(form.target).toBe("");
    const button = within(form).getByRole("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Get API Key");
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("issue-waiting")).toBeNull();
  });

  it("reads the account again when the window is shut without a word", async () => {
    const fetchMock = stubHub({ account: () => answer(200, NO_KEY) });
    const popup = fakeWindow();
    opens(popup);
    renderAt("/api/dashboard/x402");
    const form = await getKeyForm();
    vi.useFakeTimers();
    fireEvent.submit(form);
    expect(screen.getByTestId("issue-waiting")).toBeTruthy();

    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.queryByTestId("issue-waiting")).toBeNull();
    expect(document.querySelector('[data-testid^="issue-"]')).toBeNull();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(2);
  });

  it("doesn't take another site's word for the window's", async () => {
    const fetchMock = stubHub({ account: () => answer(200, NO_KEY) });
    opens(fakeWindow());
    renderAt("/api/dashboard/x402");
    fireEvent.submit(await getKeyForm());
    await windowLands("?issue=issued", "https://evil.example");
    await settle();
    expect(screen.getByTestId("issue-waiting")).toBeTruthy();
    expect(screen.queryByTestId("issue-issued")).toBeNull();
    expect(requests(fetchMock).filter((r) => r.endsWith("/account"))).toHaveLength(1);
  });
});
