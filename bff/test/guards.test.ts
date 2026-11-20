import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  AUTH_LIMIT_PER_MINUTE,
  createHub,
  LIMIT_PER_MINUTE,
  ORIGIN_SECRET_HEADER,
} from "../src/app.ts";
import type { HubSettings } from "../src/settings.ts";
import { FakeDiscord } from "./fake-discord.ts";

const PUBLIC_ORIGIN = "http://localhost:5173";
const NOW = Date.UTC(2026, 10, 20, 12);

/** `app.test.ts`'s settings, passed in full: no test reads the process's environment. */
const SETTINGS: HubSettings = {
  publicOrigin: PUBLIC_ORIGIN,
  base: "/api/",
  discordClientId: "1234567890",
  discordClientSecret: "the-client-secret",
  sessionSecret: Buffer.alloc(32, 9),
  guildId: "897514728459468821",
  pricesTokenSecretName: "sorobanscan-hub/production/prices-token",
  pricesHubApi: "https://prices-api.sorobanscan.com/api/hub/v1",
  x402TokenSecretName: "sorobanscan-hub/production/x402-token",
  x402HubApi: "https://x402-portal.sorobanscan.com/api/hub/v1",
  products: ["prices"],
  minAccountAgeMinutes: 5,
};

/** The secret CloudFront adds, as the Lambda's entry would hand it over: two values in rotation. */
const ORIGIN_SECRET = { current: "a".repeat(64), previous: "b".repeat(64) };

/** Where CloudFront's function writes the viewer's address. */
const VIEWER_IP_HEADER = "x-hub-viewer-ip";
const ADDRESS = "198.51.100.7";
const OTHER_ADDRESS = "203.0.113.20";

/** Where a refusal over the sign-in routes' limit sends the browser. */
const BUSY = "/api/login?signin=busy";
const DISCORD = "https://discord.test/oauth2/authorize";

/**
 * Every status the hub answered in the running test. After each test none may be 403 or 404: the
 * production CDN turns those into another page (`app.test.ts`).
 */
const statuses: number[] = [];

let logs: MockInstance[] = [];
/** Everything the hub wrote to the console. */
const logged = () =>
  logs.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");

beforeEach(() => {
  logs = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  const answered = statuses.splice(0);
  expect(answered.filter((status) => status === 403 || status === 404)).toEqual([]);
});

type Sent = {
  method?: string;
  /** `X-Hub-Viewer-Ip`, as CloudFront's function writes it; `null` sends none. */
  ip?: string | null;
  /** `X-Hub-Origin-Secret`; the hub's current one unless given, `null` sends none. */
  secret?: string | null;
  /** `Origin`: the page's on a `POST` unless given, `null` sends none. */
  origin?: string | null;
  /** A form's urlencoded body. */
  form?: string;
};

/** A hub with Discord in memory and a clock the test moves. */
function startHub(settings: Partial<HubSettings> = {}) {
  let now = NOW;
  const discord = new FakeDiscord();
  const hub = createHub({ ...SETTINGS, ...settings }, { discord, now: () => now });
  const secret = settings.originSecret?.current;
  const answers: string[] = [];
  return {
    discord,
    advance: (ms: number) => void (now += ms),
    /** Every body the hub answered, for what none may hold. */
    answers,
    /** A request as CloudFront forwards one, and its status remembered. */
    async send(path: string, sent: Sent = {}): Promise<Response> {
      const method = sent.method ?? "GET";
      const headers = new Headers();
      const ip = sent.ip === undefined ? ADDRESS : sent.ip;
      if (ip !== null) headers.set(VIEWER_IP_HEADER, ip);
      const given = sent.secret === undefined ? secret : sent.secret;
      if (given !== null && given !== undefined) headers.set(ORIGIN_SECRET_HEADER, given);
      const origin = sent.origin === undefined && method === "POST" ? PUBLIC_ORIGIN : sent.origin;
      if (origin) headers.set("origin", origin);
      if (sent.form !== undefined) headers.set("content-type", "application/x-www-form-urlencoded");
      const response = await hub.request(path, { method, headers, body: sent.form });
      statuses.push(response.status);
      answers.push(
        `${response.headers.get("location") ?? ""} ${await response.clone().text()}`,
      );
      return response;
    },
  };
}

const locationOf = (response: Response) => response.headers.get("location") ?? "";
const toDiscord = (response: Response) =>
  response.status === 303 && locationOf(response).startsWith(DISCORD);

async function expectNotThroughTheSite(response: Response, what: string) {
  expect(response.status, what).toBe(400);
  expect(await response.json(), what).toEqual({ error: "not_through_the_site" });
  expect(response.headers.getSetCookie(), what).toEqual([]);
}

async function expectRateLimited(response: Response, what = "") {
  expect(response.status, what).toBe(429);
  expect(await response.json(), what).toEqual({ error: "rate_limited" });
  const retryAfter = response.headers.get("retry-after") ?? "";
  expect(retryAfter, what).toMatch(/^[0-9]+$/);
  expect(Number(retryAfter), what).toBeGreaterThanOrEqual(1);
  expect(Number(retryAfter), what).toBeLessThanOrEqual(60);
}

describe("only through CloudFront", () => {
  it("names the header and the two limits", () => {
    expect(ORIGIN_SECRET_HEADER).toBe("x-hub-origin-secret");
    expect(AUTH_LIMIT_PER_MINUTE).toBe(30);
    expect(LIMIT_PER_MINUTE).toBe(120);
  });

  // Before every route: a sign-in, a callback, an issue, a product's call, an unknown path.
  it("refuses a request without the secret, with a wrong one or one of another length", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    const routes: [string, Sent][] = [
      ["/api/hub/me", {}],
      ["/api/hub/auth/login", {}],
      ["/api/hub/auth/callback?code=c&state=s", {}],
      ["/api/hub/auth/issue", { method: "POST", form: "product=prices" }],
      ["/api/hub/auth/logout", { method: "POST" }],
      ["/api/hub/prices/account", {}],
      ["/api/hub/prices/key/reveal", { method: "POST" }],
      ["/api/hub/nothing", {}],
    ];
    for (const secret of [
      null,
      "",
      "c".repeat(64),
      "A".repeat(64),
      // Each value's first 63, and each with one more.
      "a".repeat(63),
      "b".repeat(63),
      "a".repeat(65),
      "b".repeat(65),
      `${"a".repeat(64)}${"b".repeat(64)}`,
    ]) {
      for (const [path, sent] of routes) {
        const what = `${sent.method ?? "GET"} ${path} with ${String(secret?.slice(0, 3))}…`;
        await expectNotThroughTheSite(await hub.send(path, { ...sent, secret }), what);
      }
    }
    // No route ran: Discord was asked for nothing.
    expect(hub.discord.authorizations).toEqual([]);
  });

  it("lets the current secret and the previous one through", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    for (const secret of [ORIGIN_SECRET.current, ORIGIN_SECRET.previous]) {
      const me = await hub.send("/api/hub/me", { secret });
      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({ authenticated: false });
      expect(toDiscord(await hub.send("/api/hub/auth/login", { secret }))).toBe(true);
    }
  });

  it("checks only the current secret when there is no previous one", async () => {
    const hub = startHub({ originSecret: { current: ORIGIN_SECRET.current } });
    expect((await hub.send("/api/hub/me", { secret: ORIGIN_SECRET.current })).status).toBe(200);
    await expectNotThroughTheSite(
      await hub.send("/api/hub/me", { secret: ORIGIN_SECRET.previous }),
      "the old one",
    );
  });

  // A secret handed over empty shuts the backend: it doesn't open it to an empty header.
  it("matches nothing with an empty value", async () => {
    const hub = startHub({ originSecret: { current: "", previous: "" } });
    for (const secret of [null, "", "a".repeat(64)]) {
      await expectNotThroughTheSite(
        await hub.send("/api/hub/me", { secret }),
        `with ${String(secret?.slice(0, 3))}`,
      );
    }
  });

  // A refusal spends nothing, so calls that never passed the distribution can't take the limit
  // away from those that did.
  it("doesn't count a refused request", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    for (let i = 0; i < 200; i++) {
      const path = i % 2 === 0 ? "/api/hub/me" : "/api/hub/auth/login";
      expect((await hub.send(path, { secret: null })).status).toBe(400);
    }
    expect((await hub.send("/api/hub/me")).status).toBe(200);
    expect(toDiscord(await hub.send("/api/hub/auth/login"))).toBe(true);
  });

  it("checks the secret before the Origin", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    await expectNotThroughTheSite(
      await hub.send("/api/hub/auth/logout", { method: "POST", secret: null, origin: null }),
      "a POST with neither",
    );
    const withSecret = await hub.send("/api/hub/auth/logout", { method: "POST", origin: null });
    expect(withSecret.status).toBe(400);
    expect(await withSecret.json()).toEqual({ error: "bad_origin" });
  });

  it("makes no such check without the setting, as on pnpm dev and pnpm preview", async () => {
    const hub = startHub();
    const me = await hub.send("/api/hub/me", { secret: null });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ authenticated: false });
    // A header sent anyway is not read.
    expect((await hub.send("/api/hub/me", { secret: "anything" })).status).toBe(200);
  });

  it("never says a secret's value in an answer or a log line", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    for (const secret of [null, "c".repeat(64), "a".repeat(63), ORIGIN_SECRET.current]) {
      await hub.send("/api/hub/me", { secret });
      await hub.send("/api/hub/auth/callback?code=c&state=s", { secret });
      await hub.send("/api/hub/auth/logout", { method: "POST", origin: null, secret });
    }
    for (const value of [ORIGIN_SECRET.current, ORIGIN_SECRET.previous]) {
      expect(logged()).not.toContain(value.slice(0, 16));
      expect(hub.answers.join("\n")).not.toContain(value.slice(0, 16));
    }
  });
});

describe("the request limit", () => {
  it("sends the browser from one address to the sign-in page after 30 sign-ins a minute", async () => {
    const hub = startHub();
    for (let i = 0; i < 30; i++) {
      expect(toDiscord(await hub.send("/api/hub/auth/login")), `sign-in ${i + 1}`).toBe(true);
    }
    const busy = await hub.send("/api/hub/auth/login");
    expect(busy.status).toBe(303);
    expect(locationOf(busy)).toBe(BUSY);
    // Nothing was started: no cookie, and Discord was asked for 30 round trips.
    expect(busy.headers.getSetCookie()).toEqual([]);
    expect(hub.discord.authorizations).toHaveLength(30);

    hub.advance(59_999);
    expect(locationOf(await hub.send("/api/hub/auth/login"))).toBe(BUSY);
    hub.advance(1);
    expect(toDiscord(await hub.send("/api/hub/auth/login"))).toBe(true);
  });

  it.each([
    ["GET", "/api/hub/auth/callback?code=c&state=s", undefined, "/api/login?signin=failed"],
    ["POST", "/api/hub/auth/issue", "product=prices", "/api/login"],
  ])(
    "sends the 31st %s %s from one address to the sign-in page as busy",
    async (method, path, form, usual) => {
      const hub = startHub();
      for (let i = 0; i < 30; i++) {
        const response = await hub.send(path, { method, form });
        expect(response.status, `request ${i + 1}`).toBe(303);
        expect(locationOf(response), `request ${i + 1}`).toBe(usual);
      }
      const busy = await hub.send(path, { method, form });
      expect(busy.status).toBe(303);
      expect(locationOf(busy)).toBe(BUSY);
      expect(busy.headers.getSetCookie()).toEqual([]);
      hub.advance(60_000);
      expect(locationOf(await hub.send(path, { method, form }))).toBe(usual);
    },
  );

  // Not a page a browser opens: its refusal is the JSON a `fetch` reads.
  it("answers a sign-out over the sign-in routes' limit 429 rate_limited", async () => {
    const hub = startHub();
    for (let i = 0; i < 30; i++) await hub.send("/api/hub/auth/login");
    await expectRateLimited(await hub.send("/api/hub/auth/logout", { method: "POST" }));
  });

  it("answers the 121st other request from one address 429, with Retry-After", async () => {
    const hub = startHub();
    for (let i = 0; i < 120; i++) {
      expect((await hub.send("/api/hub/me")).status, `request ${i + 1}`).toBe(200);
    }
    await expectRateLimited(await hub.send("/api/hub/me"), "me");
    await expectRateLimited(await hub.send("/api/hub/prices/account"), "account");
    await expectRateLimited(
      await hub.send("/api/hub/prices/key/reveal", { method: "POST" }),
      "reveal",
    );
    // Another address has its own count.
    expect((await hub.send("/api/hub/me", { ip: OTHER_ADDRESS })).status).toBe(200);

    // What is left of the minute, in whole seconds.
    hub.advance(15_500);
    const later = await hub.send("/api/hub/me");
    expect(later.headers.get("retry-after")).toBe("45");
    hub.advance(44_500);
    expect((await hub.send("/api/hub/me")).status).toBe(200);
  });

  it("counts a POST the Origin check refuses", async () => {
    const hub = startHub();
    for (let i = 0; i < 120; i++) {
      const response = await hub.send("/api/hub/prices/key/reveal", {
        method: "POST",
        origin: "https://evil.example",
      });
      expect(response.status).toBe(400);
    }
    const over = await hub.send("/api/hub/prices/key/reveal", {
      method: "POST",
      origin: "https://evil.example",
    });
    await expectRateLimited(over);
  });

  it("counts two IPv6 addresses of one /56 together", async () => {
    const hub = startHub();
    for (let i = 0; i < 60; i++) {
      expect((await hub.send("/api/hub/me", { ip: "2001:db8:abcd:1200::1" })).status).toBe(200);
      expect(
        (await hub.send("/api/hub/me", { ip: "2001:db8:abcd:12ff:ffff:ffff:ffff:fffe" })).status,
      ).toBe(200);
    }
    await expectRateLimited(await hub.send("/api/hub/me", { ip: "2001:db8:abcd:1234::9" }));
    // The next /56 is another client.
    expect((await hub.send("/api/hub/me", { ip: "2001:db8:abcd:1300::1" })).status).toBe(200);
  });

  // Many people behind one address spend the sign-in routes' limit: the dashboard keeps working.
  it("keeps the two limits apart", async () => {
    const signingIn = startHub();
    for (let i = 0; i < 31; i++) await signingIn.send("/api/hub/auth/login");
    expect(locationOf(await signingIn.send("/api/hub/auth/login"))).toBe(BUSY);
    const me = await signingIn.send("/api/hub/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ authenticated: false });

    const reading = startHub();
    for (let i = 0; i < 121; i++) await reading.send("/api/hub/me");
    await expectRateLimited(await reading.send("/api/hub/me"));
    expect(toDiscord(await reading.send("/api/hub/auth/login"))).toBe(true);
  });

  it("counts every request with no viewer address, or one that isn't one, together", async () => {
    const hub = startHub();
    for (let i = 0; i < 60; i++) {
      expect((await hub.send("/api/hub/me", { ip: null })).status).toBe(200);
      expect((await hub.send("/api/hub/me", { ip: `${ADDRESS}:443` })).status).toBe(200);
    }
    await expectRateLimited(await hub.send("/api/hub/me", { ip: null }));
    await expectRateLimited(await hub.send("/api/hub/me", { ip: "not an address" }));
    expect((await hub.send("/api/hub/me", { ip: ADDRESS })).status).toBe(200);
  });

  it("counts only requests that passed the secret, with it set", async () => {
    const hub = startHub({ originSecret: ORIGIN_SECRET });
    for (let i = 0; i < 30; i++) {
      expect(toDiscord(await hub.send("/api/hub/auth/login"))).toBe(true);
    }
    expect(locationOf(await hub.send("/api/hub/auth/login"))).toBe(BUSY);
    // Without the secret it is refused as before, not sent anywhere.
    await expectNotThroughTheSite(
      await hub.send("/api/hub/auth/login", { secret: null }),
      "no secret",
    );
  });
});
