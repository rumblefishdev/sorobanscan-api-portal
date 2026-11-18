import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createHub, SESSION_TTL_SECONDS, type HubDeps } from "../src/app.ts";
import { productSecret, ProductSecretError, type SecretsClient } from "../src/product-secret.ts";
import { PRICES_TIMEOUT_MS, pricesClient, type Caller } from "../src/products/prices.ts";
import type { HubSettings } from "../src/settings.ts";
import { tokens } from "../src/tokens.ts";
import { ACCOUNT_ID, FakeDiscord } from "./fake-discord.ts";
import {
  envelope,
  FakePrices,
  KEY_VALUE,
  later,
  PRICES_API,
  PRICES_SECRET,
  type Answer,
  type PricesCall,
  type PricesRoute,
} from "./fake-prices.ts";

const PUBLIC_ORIGIN = "http://localhost:5173";
const NOW = Date.UTC(2026, 10, 17, 12);

/** Passed in full: no test reads the process's environment or `.env.local`. */
const SETTINGS: HubSettings = {
  publicOrigin: PUBLIC_ORIGIN,
  base: "/api/",
  discordClientId: "1234567890",
  discordClientSecret: "the-client-secret",
  sessionSecret: Buffer.alloc(32, 9),
  guildId: "897514728459468821",
  pricesTokenSecretName: "sorobanscan-hub/production/prices-token",
  pricesHubApi: PRICES_API,
  products: ["prices"],
  minAccountAgeMinutes: 5,
};

/** The page's three routes to Prices, with the call each makes and the act its token is for. */
const ROUTES = [
  { method: "GET", path: "/api/hub/prices/account", prices: "/account", act: "read" },
  { method: "POST", path: "/api/hub/prices/key/reveal", prices: "/key/reveal", act: "reveal" },
  { method: "POST", path: "/api/hub/prices/key/revoke", prices: "/key/revoke", act: "revoke" },
] as const;

/**
 * Every status the hub answered in the running test. None may be 403 or 404: the production CDN
 * turns those into another page.
 */
const statuses: number[] = [];

let logs: MockInstance[] = [];
/** Everything the hub wrote to the console, in the order it was written, whatever the level. */
const logged = () =>
  logs
    .flatMap((spy) =>
      spy.mock.calls.map((args, i) => ({
        at: spy.mock.invocationCallOrder[i] ?? 0,
        line: args.map(String).join(" "),
      })),
    )
    .sort((a, b) => a.at - b.at)
    .map(({ line }) => line)
    .join("\n");

beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const answered = statuses.splice(0);
  expect(answered.filter((status) => status === 403 || status === 404)).toEqual([]);
});

/** A hub with Discord and Prices in memory, a clock the test moves, and a signed-in visitor. */
function startHub(settings: Partial<HubSettings> = {}, deps: HubDeps = {}) {
  let now = NOW;
  const clock = () => now;
  const prices = new FakePrices(clock);
  const discord = new FakeDiscord();
  const hub = createHub(
    { ...SETTINGS, ...settings },
    {
      discord,
      now: clock,
      fetch: prices.fetch,
      pricesSecret: () => Promise.resolve(PRICES_SECRET),
      ...deps,
    },
  );
  const signer = tokens(SETTINGS.sessionSecret, clock);
  /** The cookie the hub's callback sets for the member Discord signs in. */
  const session = signer.sign(
    "session",
    { id: ACCOUNT_ID, username: "member" },
    SESSION_TTL_SECONDS,
  );
  return {
    hub,
    prices,
    discord,
    signer,
    session,
    advance: (ms: number) => void (now += ms),
    /**
     * A request as the page makes one: with the session unless `cookie` says otherwise, and a
     * `POST` naming the page's origin unless `origin` does.
     */
    async request(
      path: string,
      init: { method?: string; cookie?: string | null; origin?: string | null } = {},
    ): Promise<Response> {
      const method = init.method ?? "GET";
      const headers = new Headers();
      const cookie = init.cookie === undefined ? `hub_session=${session}` : init.cookie;
      if (cookie) headers.set("cookie", cookie);
      const origin = init.origin === undefined && method === "POST" ? PUBLIC_ORIGIN : init.origin;
      if (origin) headers.set("origin", origin);
      const response = await hub.request(path, { method, headers });
      statuses.push(response.status);
      return response;
    },
  };
}

describe("the Prices tab's routes", () => {
  it("call Prices once each, with a token of their own for that call's act", async () => {
    const hub = startHub();
    for (const route of ROUTES) {
      const response = await hub.request(route.path, { method: route.method });
      expect(response.status, route.path).toBe(200);
      expect(await response.json(), route.path).toEqual(FakePrices.usual(route.prices, ACCOUNT_ID));
      expect(response.headers.get("cache-control"), route.path).toBe("no-store");
    }

    expect(hub.prices.calls.map((call) => [call.method, call.url])).toEqual(
      ROUTES.map((route) => [route.method, `${PRICES_API}${route.prices}`]),
    );
    const seconds = NOW / 1000;
    expect(hub.prices.accepted.map((call) => call.claims)).toEqual(
      ROUTES.map((route) => ({
        iss: "https://sorobanscan.com/api/hub",
        aud: "prices",
        sub: `discord:${ACCOUNT_ID}`,
        name: "member",
        iat: seconds,
        exp: seconds + 60,
        jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        act: route.act,
      })),
    );
    // One token per call: no two share a token or a jti.
    expect(new Set(hub.prices.calls.map((call) => call.token)).size).toBe(ROUTES.length);
    expect(new Set(hub.prices.accepted.map((call) => call.claims.jti)).size).toBe(ROUTES.length);

    for (const call of hub.prices.calls) {
      // The token and nothing of the browser's: no cookie, no origin, no body.
      expect([...call.headers.keys()].sort(), call.url).toEqual(["accept", "authorization"]);
      expect(call.headers.get("accept")).toBe("application/json");
      expect(call.body ?? null).toBeNull();
      // A redirect is an answer to read, not one to follow with the token.
      expect(call.redirect).toBe("manual");
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("take the session a sign-in made", async () => {
    const hub = startHub();
    const login = await hub.request("/api/hub/auth/login", { cookie: null });
    const state = new URL(login.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const pending = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const back = await hub.request(
      `/api/hub/auth/callback?${new URLSearchParams({ state, code: hub.discord.codeFor(state) })}`,
      { cookie: pending },
    );
    expect(back.headers.get("location")).toBe("/api/dashboard");
    const session = back.headers
      .getSetCookie()
      .find((line) => line.startsWith("hub_session="))
      ?.split(";")[0];

    const account = await hub.request("/api/hub/prices/account", { cookie: session ?? "" });
    expect(account.status).toBe(200);
    expect(hub.prices.accepted.map((call) => call.claims.sub)).toEqual([`discord:${ACCOUNT_ID}`]);
  });

  it("answer 401 not_signed_in without a session, asking Prices nothing", async () => {
    const hub = startHub();
    const otherSecret = tokens(Buffer.alloc(32, 1), () => NOW).sign(
      "session",
      { id: ACCOUNT_ID, username: "member" },
      SESSION_TTL_SECONDS,
    );
    // A value signed for another purpose, even one holding a session's claims, is not a session.
    const asState = hub.signer.sign(
      "state",
      { id: ACCOUNT_ID, username: "member" },
      SESSION_TTL_SECONDS,
    );
    const noId = hub.signer.sign("session", { username: "member" }, SESSION_TTL_SECONDS);
    const notSnowflake = hub.signer.sign(
      "session",
      { id: "member", username: "member" },
      SESSION_TTL_SECONDS,
    );
    for (const cookie of [
      null,
      "hub_session=",
      "hub_session=garbage",
      `hub_session=${otherSecret}`,
      `hub_session=${asState}`,
      `hub_session=${noId}`,
      `hub_session=${notSnowflake}`,
      `other=${hub.session}`,
    ]) {
      for (const route of [
        ...ROUTES,
        { method: "GET", path: "/api/hub/x402/account" },
      ] as const) {
        const response = await hub.request(route.path, { method: route.method, cookie });
        expect(response.status, `${route.path} ${cookie}`).toBe(401);
        expect(await response.json()).toEqual({ error: "not_signed_in" });
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }

    // Nor once the session has expired.
    hub.advance(SESSION_TTL_SECONDS * 1000);
    for (const route of ROUTES) {
      const response = await hub.request(route.path, { method: route.method });
      expect(response.status, route.path).toBe(401);
    }
    expect(hub.prices.calls).toEqual([]);
  });

  it("refuse a POST without the page's Origin, asking Prices nothing", async () => {
    const hub = startHub();
    for (const origin of [null, "https://evil.example", "http://localhost:5174", "null"]) {
      for (const route of ROUTES.filter((r) => r.method === "POST")) {
        const response = await hub.request(route.path, { method: "POST", origin });
        expect(response.status, `${route.path} ${origin}`).toBe(400);
        expect(await response.json()).toEqual({ error: "bad_origin" });
      }
    }
    expect(hub.prices.calls).toEqual([]);
  });

  it("answer 400 unknown_product for a product the backend doesn't serve", async () => {
    const hub = startHub();
    for (const [method, path] of [
      ["GET", "/api/hub/x402/account"],
      ["POST", "/api/hub/x402/key/reveal"],
      ["POST", "/api/hub/x402/key/revoke"],
      ["GET", "/api/hub/Prices/account"],
      ["GET", "/api/hub/__proto__/account"],
      ["GET", "/api/hub/constructor/account"],
      ["POST", "/api/hub/toString/key/revoke"],
    ] as const) {
      const response = await hub.request(path, { method });
      expect(response.status, path).toBe(400);
      expect(await response.json(), path).toEqual({ error: "unknown_product" });
    }

    // Prices too, when the backend's own list leaves it out.
    const without = startHub({ products: [] });
    for (const route of ROUTES) {
      const response = await without.request(route.path, { method: route.method });
      expect(response.status, route.path).toBe(400);
      expect(await response.json()).toEqual({ error: "unknown_product" });
    }
    expect([...hub.prices.calls, ...without.prices.calls]).toEqual([]);
  });

  it("answer 503 product_not_configured without the secret, and sign-in still works", async () => {
    const reads: unknown[] = [];
    const denied: SecretsClient = {
      send(command) {
        reads.push(command);
        const error = new Error("AccessDenied: the SDK's words");
        return Promise.reject(Object.assign(error, { name: "AccessDeniedException" }));
      },
    };
    const secret = productSecret(SETTINGS.pricesTokenSecretName, denied, () => NOW);
    const hub = startHub({}, { pricesSecret: secret });
    for (const route of [...ROUTES, ...ROUTES]) {
      const response = await hub.request(route.path, { method: route.method });
      expect(response.status, route.path).toBe(503);
      expect(await response.json()).toEqual({ error: "product_not_configured" });
    }
    expect(hub.prices.calls).toEqual([]);
    // Said once, by the secret's reader: the routes add nothing to it.
    expect(reads).toHaveLength(1);
    expect(logged().split("\n")).toEqual([
      expect.stringMatching(/^product_secret_unavailable .*AccessDeniedException/),
    ]);

    // Signing in asks for no secret.
    const me = await hub.request("/api/hub/me");
    expect(await me.json()).toEqual({ authenticated: true, id: ACCOUNT_ID, username: "member" });
    const login = await hub.request("/api/hub/auth/login", { cookie: null });
    expect(login.status).toBe(303);
    expect(reads).toHaveLength(1);

    // Any secret that can't be had is the same answer, and the hub logs nothing of its own.
    vi.clearAllMocks();
    const unread = new ProductSecretError("the secret could not be read");
    const failing = startHub({}, { pricesSecret: () => Promise.reject(unread) });
    const response = await failing.request("/api/hub/prices/account");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "product_not_configured" });
    expect(logged()).toBe("");
  });

  it("pass Prices' error codes on as {error}, with its details, never its message", async () => {
    const revoked = {
      next_eligible_at: "2026-12-01T00:00:00Z",
      revoked_at: "2026-11-02T08:00:00Z",
    };
    const cases: [PricesRoute, () => Answer, number, Record<string, unknown>][] = [
      ["/key/reveal", envelope(404, "no_key"), 409, { error: "no_key" }],
      [
        "/key/reveal",
        envelope(404, "key_revoked", revoked),
        409,
        { error: "key_revoked", details: revoked },
      ],
      ["/key/revoke", envelope(404, "no_key"), 409, { error: "no_key" }],
      ["/key/revoke", envelope(502, "key_unavailable"), 502, { error: "key_unavailable" }],
      ["/account", envelope(502, "usage_unavailable"), 502, { error: "usage_unavailable" }],
      ["/account", envelope(500, "internal_error"), 500, { error: "internal_error" }],
      ["/account", envelope(400, "invalid_body"), 400, { error: "invalid_body" }],
      // Prices refusing the hub's own token or act is the hub's fault, not the visitor's: a 401
      // would read as "not signed in", and a 403 never gets past the CDN.
      ["/account", envelope(401, "invalid_token"), 502, { error: "invalid_token" }],
      ["/key/revoke", envelope(403, "action_not_allowed"), 502, { error: "action_not_allowed" }],
      // Details that aren't an object are dropped, not passed on.
      ["/key/reveal", envelope(404, "key_revoked", ["x"]), 409, { error: "key_revoked" }],
      ["/key/reveal", envelope(404, "key_revoked", "x"), 409, { error: "key_revoked" }],
    ];
    for (const [path, answer, status, body] of cases) {
      vi.clearAllMocks();
      const hub = startHub();
      hub.prices.answer(path, answer);
      const route = ROUTES.find((r) => r.prices === path);
      const response = await hub.request(route?.path ?? "", { method: route?.method });
      const what = `${path} ${JSON.stringify(body)}`;
      expect(response.status, what).toBe(status);
      const text = await response.text();
      expect(JSON.parse(text), what).toEqual(body);
      expect(text, what).not.toContain("say-nothing-of-this");
      expect(hub.prices.calls, what).toHaveLength(1);

      const [call] = hub.prices.accepted;
      expect(logged(), what).toBe(
        failure(route?.act, call, `Prices answered ${answerStatus(answer)} ${body.error}`),
      );
    }
  });

  it("try once more after a 503, with a new token", async () => {
    const hub = startHub();
    hub.prices.answer("/key/revoke", envelope(503, "key_unavailable"));
    const response = await hub.request("/api/hub/prices/key/revoke", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(FakePrices.usual("/key/revoke", ACCOUNT_ID));
    const [first, second] = hub.prices.accepted;
    expect(hub.prices.accepted).toHaveLength(2);
    expect(first?.claims.act).toBe("revoke");
    expect(second?.claims.act).toBe("revoke");
    expect(second?.claims.jti).not.toBe(first?.claims.jti);
    expect(logged().split("\n")).toEqual([
      failure("revoke", first, "Prices answered 503 key_unavailable").replace(
        "prices_call_failed",
        "prices_call_retried",
      ),
      `prices_key_revoked discord:${ACCOUNT_ID} jti:${second?.claims.jti}`,
    ]);

    // Twice is Prices' answer, and once more is all.
    const unavailable = { error: "prices_unavailable" };
    for (const [answer, body, status] of [
      [envelope(503, "hub_unconfigured"), { error: "hub_unconfigured" }, 503],
      [() => new Response("<html>Service Unavailable</html>", { status: 503 }), unavailable, 502],
      [() => Response.json({ message: "Service Unavailable" }, { status: 503 }), unavailable, 502],
    ] as const) {
      const again = startHub();
      again.prices.answer("/account", answer, answer, answer);
      const answered = await again.request("/api/hub/prices/account");
      expect(answered.status).toBe(status);
      expect(await answered.json()).toEqual(body);
      expect(again.prices.accepted).toHaveLength(2);
    }

    // Any other failure is not tried again.
    for (const answer of [
      envelope(502, "key_unavailable"),
      envelope(500, "internal_error"),
      () => new Response("<html>", { status: 502 }),
      () => Response.json({ message: "Too Many Requests" }, { status: 429 }),
      () => new TypeError("fetch failed"),
    ]) {
      const once = startHub();
      once.prices.answer("/account", answer, answer);
      await once.request("/api/hub/prices/account");
      expect(once.prices.calls).toHaveLength(1);
    }
  });

  it("answer a 429 without Prices' envelope with 503 prices_busy", async () => {
    for (const answer of [
      () => Response.json({ message: "Too Many Requests" }, { status: 429 }),
      () => new Response("<html><body>Rate limited</body></html>", { status: 429 }),
      () => new Response("", { status: 429 }),
    ]) {
      vi.clearAllMocks();
      const hub = startHub();
      hub.prices.answer("/account", answer);
      const response = await hub.request("/api/hub/prices/account");
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "prices_busy" });
      expect(text).not.toMatch(/Too Many|Rate limited/);
      const [call] = hub.prices.accepted;
      expect(logged()).toBe(
        failure("read", call, "Prices answered 429 without its error envelope"),
      );
    }
    // Prices' own 429, in its envelope, is its answer.
    const hub = startHub();
    hub.prices.answer("/account", envelope(429, "slow_down"));
    const response = await hub.request("/api/hub/prices/account");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "slow_down" });
  });

  it("answer anything but Prices' JSON with 502 prices_unavailable, not repeating it", async () => {
    const html = "<html><body>say-nothing-of-this</body></html>";
    const notCode = "Say Nothing Of This";
    const cases: [string, () => Answer, string][] = [
      ["an HTML 200", () => new Response(html), "200 without a JSON object"],
      ["a JSON array", () => Response.json(["say-nothing-of-this"]), "200 without a JSON object"],
      ["JSON null", () => Response.json(null), "200 without a JSON object"],
      ["a JSON string", () => Response.json("say-nothing-of-this"), "200 without a JSON object"],
      ["an empty 200", () => new Response(""), "200 without a JSON object"],
      ["a CDN's 502", () => new Response(html, { status: 502 }), "502 without its error envelope"],
      [
        "the gateway's 500",
        () => Response.json({ message: "say-nothing-of-this" }, { status: 500 }),
        "500 without its error envelope",
      ],
      [
        "the gateway's 403",
        () => Response.json({ message: "say-nothing-of-this" }, { status: 403 }),
        "403 without its error envelope",
      ],
      ["an HTML 404", () => new Response(html, { status: 404 }), "404 without its error envelope"],
      [
        "a redirect",
        () =>
          new Response(html, { status: 302, headers: { location: "https://say-nothing-of-this" } }),
        "302 without its error envelope",
      ],
      ["a code that isn't one", envelope(404, notCode), "404 without its error envelope"],
      ["a code that isn't text", envelope(404, 404), "404 without its error envelope"],
    ];
    for (const [what, answer, said] of cases) {
      vi.clearAllMocks();
      const hub = startHub();
      hub.prices.answer("/account", answer);
      const response = await hub.request("/api/hub/prices/account");
      expect(response.status, what).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text), what).toEqual({ error: "prices_unavailable" });
      expect(text, what).not.toMatch(/say-nothing-of-this/i);
      const [call] = hub.prices.accepted;
      expect(logged(), what).toBe(failure("read", call, `Prices answered ${said}`));
    }
  });

  it("answer 502 prices_unavailable when Prices can't be reached, naming only how", async () => {
    const hub = startHub();
    hub.prices.answer("/key/reveal", () =>
      Object.assign(new TypeError("fetch failed: say-nothing-of-this"), {
        cause: new Error("getaddrinfo ENOTFOUND"),
      }),
    );
    const response = await hub.request("/api/hub/prices/key/reveal", { method: "POST" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "prices_unavailable" });
    const [call] = hub.prices.accepted;
    expect(logged()).toBe(failure("reveal", call, "could not reach Prices: TypeError"));
  });

  it("give up on Prices 20 seconds after the call started, the retry included", async () => {
    vi.useFakeTimers();
    const hub = startHub();
    hub.prices.answer("/account", () => "hang");
    let settled = false;
    const answered = hub.request("/api/hub/prices/account").finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(PRICES_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await answered;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "prices_unavailable" });
    expect(PRICES_TIMEOUT_MS).toBe(20_000);
    expect(hub.prices.calls).toHaveLength(1);
    const [call] = hub.prices.accepted;
    expect(call?.signal?.aborted).toBe(true);
    expect(logged()).toBe(failure("read", call, "Prices did not answer in 20 s"));
    expect(vi.getTimerCount()).toBe(0);

    // A 503 after 15 seconds, then nothing: the retry has the 5 seconds left, no more.
    vi.clearAllMocks();
    const again = startHub();
    again.prices.answer(
      "/key/revoke",
      later(15_000, envelope(503, "key_unavailable")),
      () => "hang",
    );
    let done = false;
    const second = again
      .request("/api/hub/prices/key/revoke", { method: "POST" })
      .finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(again.prices.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(PRICES_TIMEOUT_MS - 15_000 - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await second).status).toBe(502);
    expect(again.prices.calls).toHaveLength(2);
    expect(logged()).toMatch(/\(Prices did not answer in 20 s\)$/);

    // An answer that comes late but in time is the answer.
    const slow = startHub();
    const inTime = later(PRICES_TIMEOUT_MS - 1, () => Response.json({ key: {} }));
    slow.prices.answer("/account", inTime);
    const slowly = slow.request("/api/hub/prices/account");
    await vi.advanceTimersByTimeAsync(PRICES_TIMEOUT_MS - 1);
    expect(await (await slowly).json()).toEqual({ key: {} });

    // An answer in time leaves no timer behind.
    const quick = startHub();
    expect((await quick.request("/api/hub/prices/account")).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("log each key event with the account and the jti, never a token, key or secret", async () => {
    const hub = startHub();
    await hub.request("/api/hub/prices/account");
    expect(logged()).toBe("");
    const reveal = await hub.request("/api/hub/prices/key/reveal", { method: "POST" });
    expect(await reveal.json()).toMatchObject({ value: KEY_VALUE });
    await hub.request("/api/hub/prices/key/revoke", { method: "POST" });

    const [, revealed, revoked] = hub.prices.accepted;
    expect(logged().split("\n")).toEqual([
      `prices_key_revealed discord:${ACCOUNT_ID} jti:${revealed?.claims.jti}`,
      `prices_key_revoked discord:${ACCOUNT_ID} jti:${revoked?.claims.jti}`,
    ]);
    for (const secret of [
      KEY_VALUE,
      hub.session,
      PRICES_SECRET.toString("base64"),
      PRICES_SECRET.toString("base64url"),
      PRICES_SECRET.toString("hex"),
      ...hub.prices.calls.map((call) => call.token),
      ...hub.prices.calls.map((call) => call.token.split(".")[1] ?? ""),
    ]) {
      expect(logged()).not.toContain(secret);
    }
  });
});

describe("the Prices client", () => {
  const CALLER: Caller = { discordId: ACCOUNT_ID, name: "member" };

  /** A client of a fake Prices whose next issues answer `answers`. */
  function client(answers: (() => Answer)[] = []) {
    const prices = new FakePrices(() => NOW);
    if (answers.length > 0) prices.answer("/key/issue", ...answers);
    return {
      prices,
      client: pricesClient({
        api: PRICES_API,
        signer: () => Promise.resolve(PRICES_SECRET),
        fetchImpl: prices.fetch,
        now: () => NOW,
      }),
    };
  }

  it("issues with a token for issue, passing each outcome on", async () => {
    for (const body of [
      { outcome: "issued" },
      { outcome: "has_key" },
      { outcome: "capped", next_eligible_at: "2026-12-01T00:00:00Z" },
      { outcome: "too_young" },
      { outcome: "failed" },
    ]) {
      vi.clearAllMocks();
      const { prices, client: issuing } = client([() => Response.json(body)]);
      expect(await issuing.issue(CALLER)).toEqual({ ok: true, body });
      expect(prices.calls.map((call) => [call.method, call.url])).toEqual([
        ["POST", `${PRICES_API}/key/issue`],
      ]);
      const [call] = prices.accepted;
      expect(call?.claims).toMatchObject({
        act: "issue",
        sub: `discord:${ACCOUNT_ID}`,
        name: "member",
      });
      expect(logged()).toBe(
        `prices_key_issue ${body.outcome} discord:${ACCOUNT_ID} jti:${call?.claims.jti}`,
      );
    }
  });

  it("takes an issue answer without a known outcome as prices_unavailable", async () => {
    for (const body of [
      {},
      { outcome: "maybe" },
      { outcome: ["issued"] },
      { outcome: "__proto__" },
    ]) {
      vi.clearAllMocks();
      const { client: issuing, prices } = client([() => Response.json(body)]);
      expect(await issuing.issue(CALLER), JSON.stringify(body)).toEqual({
        ok: false,
        status: 502,
        error: "prices_unavailable",
      });
      const [call] = prices.accepted;
      expect(logged()).toBe(failure("issue", call, "Prices answered 200 without a known outcome"));
    }
  });

  it("asks Prices nothing without its secret", async () => {
    const prices = new FakePrices(() => NOW);
    const failing = pricesClient({
      api: PRICES_API,
      signer: () => Promise.reject(new ProductSecretError("not today")),
      fetchImpl: prices.fetch,
    });
    for (const call of [failing.account, failing.reveal, failing.revoke, failing.issue]) {
      expect(await call(CALLER)).toEqual({
        ok: false,
        status: 503,
        error: "product_not_configured",
      });
    }
    expect(prices.calls).toEqual([]);
    expect(logged()).toBe("");
  });

  it("puts each call's path after the API's base, on its own clock", async () => {
    const urls: string[] = [];
    const at = Date.UTC(2027, 0, 1);
    /** Each token's claims, as JSON. */
    const minted: string[] = [];
    const rooted = pricesClient({
      api: "http://localhost:8080",
      signer: () => Promise.resolve(PRICES_SECRET),
      fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
        urls.push(String(input));
        const payload = new Headers(init?.headers).get("authorization")?.split(".")[1] ?? "";
        minted.push(Buffer.from(payload, "base64url").toString("utf8"));
        return Promise.resolve(Response.json({ outcome: "issued" }));
      }) as typeof fetch,
      now: () => at,
    });
    await rooted.account(CALLER);
    await rooted.reveal(CALLER);
    await rooted.revoke(CALLER);
    await rooted.issue(CALLER);
    expect(urls).toEqual([
      "http://localhost:8080/account",
      "http://localhost:8080/key/reveal",
      "http://localhost:8080/key/revoke",
      "http://localhost:8080/key/issue",
    ]);
    for (const claims of minted) expect(JSON.parse(claims)).toMatchObject({ iat: at / 1000 });
  });
});

/** The line a failed call to Prices for the signed-in member is logged with. */
function failure(act: string | undefined, call: PricesCall | undefined, why: string): string {
  return `prices_call_failed ${act} discord:${ACCOUNT_ID} jti:${call?.claims?.jti} (${why})`;
}

/** The status an answer the fake gives would have. */
function answerStatus(answer: () => Answer): number {
  const response = answer();
  return response instanceof Response ? response.status : 0;
}
