import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createHub,
  ISSUE_CALLBACK_TIMEOUT_MS,
  PENDING_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  type HubDeps,
} from "../src/app.ts";
import { createdAt, httpDiscord } from "../src/discord.ts";
import { missingSettings, readSettings, type HubSettings } from "../src/settings.ts";
import { tokens } from "../src/tokens.ts";
import { FakeProduct, type ProductRoute } from "./fake-product.ts";
import { ACCOUNT_ID, BOTH_SCOPES, FakeDiscord } from "./fake-discord.ts";
import {
  envelope,
  FakePrices,
  KEY_VALUE,
  PRICES_API,
  PRICES_SECRET,
  type Answer,
} from "./fake-prices.ts";

const PUBLIC_ORIGIN = "http://localhost:5173";
const GUILD = "897514728459468821";
const NOW = Date.UTC(2026, 10, 17, 12);

/** Passed in full: no test reads the process's environment or `.env.local`. */
const SETTINGS: HubSettings = {
  publicOrigin: PUBLIC_ORIGIN,
  base: "/api/",
  discordClientId: "1234567890",
  discordClientSecret: "the-client-secret",
  sessionSecret: Buffer.alloc(32, 9),
  guildId: GUILD,
  pricesTokenSecretName: "sorobanscan-hub/production/prices-token",
  pricesHubApi: "https://prices-api.sorobanscan.com/api/hub/v1",
  x402TokenSecretName: "sorobanscan-hub/production/x402-token",
  x402HubApi: "https://x402-portal.sorobanscan.com/api/hub/v1",
  products: ["prices"],
  minAccountAgeMinutes: 5,
};

/** A signed value: base64url claims, a dot, a base64url signature. */
const TOKEN = String.raw`[\w-]+\.[\w-]+`;
const cookieLine = (name: string, path: string, maxAge: number, secure = false) =>
  new RegExp(
    `^${name}=${TOKEN}; Path=${path}; Max-Age=${maxAge}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax$`,
  );

/**
 * Every status the hub answered in the running test. After each test none may be 403 or 404: the
 * production CDN turns those into another page.
 */
const statuses: number[] = [];

type Hub = ReturnType<typeof createHub>;

/** Sends a request to `hub` as a browser would, and remembers its status. */
async function send(hub: Hub, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await hub.request(path, init);
  statuses.push(response.status);
  return response;
}

/** A browser's cookies for the hub, each sent only under its `Path`, as a browser does. */
class Browser {
  private readonly jar = new Map<string, { value: string; path: string }>();
  constructor(private readonly hub: Hub) {}

  async request(
    path: string,
    init: {
      method?: string;
      origin?: string | null;
      cookie?: string;
      /** A form's body, urlencoded, sent as `contentType` (a form's own unless given). */
      form?: string;
      contentType?: string;
    } = {},
  ): Promise<Response> {
    const headers = new Headers();
    const [pathname = ""] = path.split("?");
    const cookie =
      init.cookie ??
      [...this.jar]
        .filter(([, set]) => pathname === set.path || pathname.startsWith(`${set.path}/`))
        .map(([name, set]) => `${name}=${set.value}`)
        .join("; ");
    if (cookie) headers.set("cookie", cookie);
    // A page's `fetch` or form that posts names its origin; a navigation to a GET doesn't.
    const origin = init.origin === undefined && init.method === "POST" ? PUBLIC_ORIGIN : init.origin;
    if (origin) headers.set("origin", origin);
    if (init.form !== undefined) {
      headers.set("content-type", init.contentType ?? "application/x-www-form-urlencoded");
    }
    const response = await send(this.hub, path, {
      method: init.method ?? "GET",
      headers,
      body: init.form,
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split("; ");
      const at = pair.indexOf("=");
      const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
      const path = attributes.find((a) => a.startsWith("Path="))?.slice("Path=".length) ?? "/";
      if (value === "" || attributes.includes("Max-Age=0")) this.jar.delete(name);
      else this.jar.set(name, { value, path });
    }
    return response;
  }

  get session(): string | undefined {
    return this.jar.get("hub_session")?.value;
  }
  get pending(): string | undefined {
    return this.jar.get("hub_oauth")?.value;
  }
  /** Puts a session in the jar, as another tab's sign-in would. */
  set session(value: string) {
    this.jar.set("hub_session", { value, path: "/api/hub" });
  }
}

const locationOf = (response: Response) => response.headers.get("location") ?? "";
const stateOf = (login: Response) => new URL(locationOf(login)).searchParams.get("state") ?? "";
const me = async (browser: Browser) => (await browser.request("/api/hub/me")).json();
const callback = (browser: Browser, query: Record<string, string>, cookie?: string) =>
  browser.request(`/api/hub/auth/callback?${new URLSearchParams(query)}`, cookie ? { cookie } : {});

/** A hub on `settings` with Discord and Prices in memory and a clock the test moves. */
function startHub(settings: Partial<HubSettings> = {}, deps: HubDeps = {}) {
  let now = NOW;
  const discord = new FakeDiscord();
  const prices = new FakePrices(() => now);
  const hub = createHub(
    { ...SETTINGS, pricesHubApi: PRICES_API, ...settings },
    {
      discord,
      now: () => now,
      fetch: prices.fetch,
      pricesSecret: () => Promise.resolve(PRICES_SECRET),
      ...deps,
    },
  );
  return {
    hub,
    discord,
    prices,
    /** The hub's own signer, for a value no sign-in would make. */
    signer: tokens(SETTINGS.sessionSecret, () => now),
    advance: (ms: number) => void (now += ms),
    browser: () => new Browser(hub),
    /** Starts a sign-in in `browser`: the state Discord carries and the code it sends back. */
    async start(browser: Browser) {
      const state = stateOf(await browser.request("/api/hub/auth/login"));
      return { state, code: discord.codeFor(state) };
    },
    /** Starts a sign-in in `browser` and comes back from Discord with it. */
    async signIn(browser: Browser) {
      const { state, code } = await this.start(browser);
      return callback(browser, { code, state });
    },
    /** Presses "Get API Key" in `browser`: the form's `POST`, with `form` as its body. */
    getKey(browser: Browser, form = "product=prices") {
      return browser.request("/api/hub/auth/issue", { method: "POST", form });
    },
    /** Presses "Get API Key" in `browser`: the state Discord carries and the code it sends back. */
    async startIssue(browser: Browser) {
      const started = await this.getKey(browser);
      expect(started.status).toBe(303);
      const state = stateOf(started);
      return { state, code: discord.codeFor(state) };
    },
    /** Presses "Get API Key" in `browser` and comes back from Discord with it. */
    async issue(browser: Browser) {
      const { state, code } = await this.startIssue(browser);
      return callback(browser, { code, state });
    },
  };
}

/** Sent back to the sign-in page with `reason`, and no session set by that answer. */
function expectRefused(response: Response, reason: string) {
  expect(response.status).toBe(303);
  expect(locationOf(response)).toBe(`/api/login?signin=${reason}`);
  expect(response.headers.getSetCookie().filter((line) => line.startsWith("hub_session="))).toEqual(
    [],
  );
}

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  const answered = statuses.splice(0);
  expect(answered.filter((status) => status === 403 || status === 404)).toEqual([]);
});

describe("the settings", () => {
  const ENV = {
    DISCORD_CLIENT_ID: "1234567890",
    DISCORD_CLIENT_SECRET: "the-client-secret",
    HUB_SESSION_SECRET: Buffer.alloc(32, 9).toString("base64"),
    HUB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  };

  it("are the four required ones, with Stellar Developers by default", () => {
    expect(readSettings(ENV, "/api/")).toEqual(SETTINGS);
    expect(
      readSettings(
        { ...ENV, DISCORD_GUILD_ID: "1234", HUB_PUBLIC_ORIGIN: "https://sorobanscan.com" },
        "/next/",
      ),
    ).toEqual({
      ...SETTINGS,
      base: "/next/",
      guildId: "1234",
      publicOrigin: "https://sorobanscan.com",
    });
    // A longer secret is fine.
    const long = Buffer.alloc(64, 1);
    expect(readSettings({ ...ENV, HUB_SESSION_SECRET: long.toString("base64") }, "/api/")).toEqual(
      { ...SETTINGS, sessionSecret: long },
    );
  });

  // The public origin too: a server other than the dev server (which gives its own) must name
  // it, or Discord would be sent back to a localhost no browser of the site's is on.
  it("are missing without any one of the four, or with one empty, and say which", () => {
    for (const name of Object.keys(ENV)) {
      expect(readSettings({ ...ENV, [name]: undefined }, "/api/"), name).toBeUndefined();
      expect(readSettings({ ...ENV, [name]: "" }, "/api/"), name).toBeUndefined();
      expect(missingSettings({ ...ENV, [name]: undefined }), name).toEqual([name]);
      expect(missingSettings({ ...ENV, [name]: "" }), name).toEqual([name]);
    }
    expect(readSettings({}, "/api/")).toBeUndefined();
    expect(missingSettings({})).toEqual(Object.keys(ENV));
    expect(missingSettings(ENV)).toEqual([]);
  });

  // Checked before "missing": a typo in one setting stops the server even while another is unset,
  // not only once the last one is filled in.
  it("refuse a malformed one even when others are missing", () => {
    for (const [malformed, named] of [
      [{ HUB_SESSION_SECRET: "too-short" }, /HUB_SESSION_SECRET/],
      [{ DISCORD_GUILD_ID: "Stellar" }, /DISCORD_GUILD_ID/],
      [{ HUB_PUBLIC_ORIGIN: "localhost:5173" }, /HUB_PUBLIC_ORIGIN/],
      [{ HUB_PRICES_TOKEN_SECRET: "prices token" }, /HUB_PRICES_TOKEN_SECRET/],
      [{ PRICES_HUB_API: "prices-api.sorobanscan.com" }, /PRICES_HUB_API/],
      [{ HUB_PRODUCTS: "price" }, /HUB_PRODUCTS/],
      [{ MIN_ACCOUNT_AGE_MINUTES: "five" }, /MIN_ACCOUNT_AGE_MINUTES/],
    ] as const) {
      for (const absent of Object.keys(ENV).filter((name) => !(name in malformed))) {
        expect(
          () => readSettings({ ...ENV, [absent]: undefined, ...malformed }, "/api/"),
          `${Object.keys(malformed)[0]} without ${absent}`,
        ).toThrow(named);
      }
      expect(() => readSettings(malformed, "/api/"), Object.keys(malformed)[0]).toThrow(named);
    }
  });

  it("refuse a session secret that isn't base64 of 32 bytes or more, without repeating it", () => {
    for (const secret of [
      "not base64 at all!",
      // 31 bytes.
      Buffer.alloc(31, 9).toString("base64"),
      // base64url, not base64.
      Buffer.alloc(32, 0xfb).toString("base64url"),
      // Without its padding, or with a line break after it.
      Buffer.alloc(32, 9).toString("base64").replace(/=+$/, ""),
      `${Buffer.alloc(32, 9).toString("base64")}\n`,
    ]) {
      let message = "";
      try {
        readSettings({ ...ENV, HUB_SESSION_SECRET: secret }, "/api/");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, secret).toMatch(/HUB_SESSION_SECRET/);
      expect(message).not.toContain(secret.trim());
    }
  });

  it("refuse a guild that isn't a Discord id, and a public origin that isn't an origin", () => {
    for (const guild of ["Stellar", "1/../2", "1 2", "1".repeat(21)]) {
      expect(() => readSettings({ ...ENV, DISCORD_GUILD_ID: guild }, "/api/"), guild).toThrow(
        /DISCORD_GUILD_ID/,
      );
    }
    for (const origin of [
      "localhost:5173",
      "http://localhost:5173/",
      "http://localhost:5173/api",
      "ftp://localhost",
      "https://user@sorobanscan.com",
    ]) {
      expect(() => readSettings({ ...ENV, HUB_PUBLIC_ORIGIN: origin }, "/api/"), origin).toThrow(
        /HUB_PUBLIC_ORIGIN/,
      );
    }
  });

  it("take the Prices tab's from the environment, production's by default", () => {
    expect(
      readSettings(
        {
          ...ENV,
          HUB_PRICES_TOKEN_SECRET: "sorobanscan-hub/staging/prices-token",
          PRICES_HUB_API: "https://prices-api.example.com/api/hub/v1",
          HUB_PRODUCTS: " prices ",
          MIN_ACCOUNT_AGE_MINUTES: "0",
        },
        "/api/",
      ),
    ).toEqual({
      ...SETTINGS,
      pricesTokenSecretName: "sorobanscan-hub/staging/prices-token",
      pricesHubApi: "https://prices-api.example.com/api/hub/v1",
      products: ["prices"],
      minAccountAgeMinutes: 0,
    });
    // Empty is unset, as for `DISCORD_GUILD_ID`.
    const empty = {
      HUB_PRICES_TOKEN_SECRET: "",
      PRICES_HUB_API: "",
      HUB_PRODUCTS: "",
      MIN_ACCOUNT_AGE_MINUTES: "",
    };
    expect(readSettings({ ...ENV, ...empty }, "/api/")).toEqual(SETTINGS);
    // Prices run on this machine, over plain HTTP, and an API at a host's root.
    for (const api of [
      "http://localhost:8080/api/hub/v1",
      "http://127.0.0.1:8080/api/hub/v1",
      "http://[::1]:8080/api/hub/v1",
      "https://prices-api.example.com",
    ]) {
      expect(readSettings({ ...ENV, PRICES_HUB_API: api }, "/api/")?.pricesHubApi, api).toBe(api);
    }
    expect(readSettings({ ...ENV, MIN_ACCOUNT_AGE_MINUTES: "1440" }, "/api/")).toMatchObject({
      minAccountAgeMinutes: 1440,
    });
  });

  // The setting holds the secret's name, but `HUB_SESSION_SECRET` beside it holds a value: one
  // pasted here by mistake must not be echoed, or sent to AWS as a name.
  it("refuse a token secret's name that isn't a name, without repeating it", () => {
    const pasted = Buffer.alloc(32, 0xa5).toString("base64");
    for (const name of [
      "my token",
      "my-token\n",
      '"my/token"',
      "a".repeat(513),
      pasted,
      Buffer.alloc(64, 0xa5).toString("base64"),
    ]) {
      let message = "";
      try {
        readSettings({ ...ENV, HUB_PRICES_TOKEN_SECRET: name }, "/api/");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, name).toMatch(/HUB_PRICES_TOKEN_SECRET/);
      expect(message, name).not.toContain(name.trim());
    }
  });

  it("refuse a Prices API that isn't HTTPS, or names a query, fragment, user or trailing slash", () => {
    for (const api of [
      "prices-api.sorobanscan.com/api/hub/v1",
      "http://prices-api.sorobanscan.com/api/hub/v1",
      "https://prices-api.sorobanscan.com/api/hub/v1/",
      "https://prices-api.sorobanscan.com/api/hub/v1?key=1",
      "https://prices-api.sorobanscan.com/api/hub/v1#top",
      "https://user:password@prices-api.sorobanscan.com/api/hub/v1",
      "ftp://prices-api.sorobanscan.com/api/hub/v1",
    ]) {
      let message = "";
      try {
        readSettings({ ...ENV, PRICES_HUB_API: api }, "/api/");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, api).toMatch(/PRICES_HUB_API/);
      // A user and password in it are not printed.
      expect(message, api).not.toContain("password");
    }
  });

  it("refuse products this backend doesn't serve, and an age that isn't whole minutes", () => {
    const refused = [
      "price",
      "Prices",
      "prices,",
      "prices;x402",
      "x402,",
      ",prices",
      "x402 prices",
    ];
    for (const products of refused) {
      expect(() => readSettings({ ...ENV, HUB_PRODUCTS: products }, "/api/"), products).toThrow(
        /HUB_PRODUCTS/,
      );
    }
    for (const age of ["five", "-1", "5.5", "1e3", " 5", "0x10", "99999999"]) {
      expect(() => readSettings({ ...ENV, MIN_ACCOUNT_AGE_MINUTES: age }, "/api/"), age).toThrow(
        /MIN_ACCOUNT_AGE_MINUTES/,
      );
    }
  });
});

describe("the hub's sign-in", () => {
  it("sends the browser to Discord with both scopes, a state, S256 and the callback", async () => {
    // The real Discord client: making the address asks Discord nothing.
    const browser = new Browser(createHub(SETTINGS, { now: () => NOW }));
    const login = await browser.request("/api/hub/auth/login");
    expect(login.status).toBe(303);
    const to = new URL(locationOf(login));
    expect(`${to.origin}${to.pathname}`).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(to.searchParams)).toEqual({
      response_type: "code",
      client_id: "1234567890",
      scope: "identify guilds.members.read",
      redirect_uri: "http://localhost:5173/api/hub/auth/callback",
      state: expect.stringMatching(new RegExp(`^${TOKEN}$`)),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
    });
    expect(locationOf(login)).not.toContain(SETTINGS.discordClientSecret);
    expect(login.headers.getSetCookie()).toEqual([
      expect.stringMatching(cookieLine("hub_oauth", "/api/hub/auth", PENDING_TTL_SECONDS)),
    ]);
    expect(PENDING_TTL_SECONDS).toBe(600);

    // The half Discord carries and the half the browser keeps share a nonce and say `signin`;
    // only the browser's holds the verifier, and the challenge is its S256.
    const signer = tokens(SETTINGS.sessionSecret, () => NOW);
    const state = signer.verify("state", to.searchParams.get("state") ?? undefined);
    const pending = signer.verify<{ nonce: string; verifier: string; exp: number }>(
      "pending",
      browser.pending,
    );
    expect(pending).toEqual({
      action: "signin",
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      verifier: expect.stringMatching(/^[\w-]{43}$/),
      exp: NOW / 1000 + PENDING_TTL_SECONDS,
    });
    expect(state).toEqual({ action: "signin", nonce: pending?.nonce, exp: pending?.exp });
    expect(createHash("sha256").update(pending?.verifier ?? "").digest("base64url")).toBe(
      to.searchParams.get("code_challenge"),
    );
    // Each sign-in its own.
    const again = await new Browser(createHub(SETTINGS)).request("/api/hub/auth/login");
    expect(stateOf(again)).not.toBe(stateOf(login));

    // `signin` may be named.
    const named = await new Browser(createHub(SETTINGS)).request(
      "/api/hub/auth/login?action=signin",
    );
    expect(named.status).toBe(303);
    expect(new URL(locationOf(named)).pathname).toBe("/oauth2/authorize");

    // Anywhere but on http://localhost the cookie is `Secure`.
    const deployed = new Browser(
      createHub({ ...SETTINGS, publicOrigin: "https://sorobanscan.com" }),
    );
    const there = await deployed.request("/api/hub/auth/login");
    expect(new URL(locationOf(there)).searchParams.get("redirect_uri")).toBe(
      "https://sorobanscan.com/api/hub/auth/callback",
    );
    expect(there.headers.getSetCookie()).toEqual([
      expect.stringMatching(cookieLine("hub_oauth", "/api/hub/auth", 600, true)),
    ]);
  });

  // Refused, not read as a sign-in: the callback would then complete another action than the one
  // the visitor confirmed, once there are more.
  it("refuses an action other than signin, starting nothing", async () => {
    const hub = startHub();
    for (const query of [
      "action=issue",
      "action=",
      "action=SIGNIN",
      "action=signin%20",
      "action=signin&action=issue",
      "action=issue&action=signin",
      "action=signin&action=signin",
    ]) {
      const browser = hub.browser();
      const response = await browser.request(`/api/hub/auth/login?${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toEqual({ error: "unknown_action" });
      expect(response.headers.get("location"), query).toBeNull();
      expect(response.headers.getSetCookie(), query).toEqual([]);
      expect(response.headers.get("cache-control"), query).toBe("no-store");
    }
  });

  it("answers its own failure with 500 internal, logging only the error's name and route", async () => {
    const discord = new FakeDiscord();
    discord.authorizeUrl = () => {
      throw new RangeError("a message that may hold anything", {
        cause: new Error("a cause that may hold anything"),
      });
    };
    const hub = createHub(SETTINGS, { discord, now: () => NOW });
    const response = await send(hub, "/api/hub/auth/login?state=from-the-query");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    // No sign-in was started, so no half of one is left in the browser.
    expect(response.headers.getSetCookie()).toEqual([]);

    expect(logged()).toBe("request_failed RangeError GET /api/hub/auth/login");
  });

  it("signs a cleared member in and lands on the dashboard", async () => {
    const hub = startHub();
    const { discord } = hub;
    const browser = hub.browser();
    const back = await hub.signIn(browser);
    expect(back.status).toBe(303);
    expect(locationOf(back)).toBe("/api/dashboard");
    expect(back.headers.getSetCookie()).toEqual([
      "hub_oauth=; Path=/api/hub/auth; Max-Age=0; HttpOnly; SameSite=Lax",
      expect.stringMatching(cookieLine("hub_session", "/api/hub", 86_400)),
    ]);
    expect(SESSION_TTL_SECONDS).toBe(86_400);
    expect(browser.pending).toBeUndefined();

    // The membership was read with this round trip's token, for the guild in the settings.
    const [code] = discord.exchanges;
    expect(discord.memberLookups).toEqual([{ token: discord.tokenFor(code ?? ""), guildId: GUILD }]);
    // The session holds the id, the username and the expiry: no Discord token.
    expect(tokens(SETTINGS.sessionSecret, () => NOW).verify("session", browser.session)).toEqual({
      id: ACCOUNT_ID,
      username: "member",
      exp: NOW / 1000 + SESSION_TTL_SECONDS,
    });
    expect(await me(browser)).toEqual({ authenticated: true, id: ACCOUNT_ID, username: "member" });

    expect(logged()).toContain(`signed_in discord:${ACCOUNT_ID}`);
    for (const secret of [
      discord.tokenFor(code ?? ""),
      code ?? "",
      browser.session ?? "",
      SETTINGS.discordClientSecret,
    ]) {
      expect(logged()).not.toContain(secret);
    }

    // Anywhere but on http://localhost both cookies are `Secure`.
    const deployed = startHub({ publicOrigin: "https://sorobanscan.com" });
    const there = await deployed.signIn(deployed.browser());
    expect(there.headers.getSetCookie()).toEqual([
      "hub_oauth=; Path=/api/hub/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      expect.stringMatching(cookieLine("hub_session", "/api/hub", 86_400, true)),
    ]);
  });

  it.each([
    ["not_member", "not_member"],
    ["pending", "pending_rules"],
    ["unknown", "unknown"],
  ] as const)("refuses a %s answer as %s, without a session", async (answer, reason) => {
    const hub = startHub();
    hub.discord.memberAnswer = answer;
    const browser = hub.browser();
    const back = await hub.signIn(browser);
    expectRefused(back, reason);
    expect(back.headers.getSetCookie()).toEqual([
      "hub_oauth=; Path=/api/hub/auth; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    expect(browser.session).toBeUndefined();
    expect(await me(browser)).toEqual({ authenticated: false });
    expect(logged()).toContain(`signin_refused ${reason}`);
    expect(logged()).toContain(`discord:${ACCOUNT_ID}`);
    expect(logged()).not.toContain("the-access-token");
  });

  it("treats Discord failing on the member lookup as unknown", async () => {
    const hub = startHub();
    hub.discord.memberAnswer = new Error("socket hang up");
    const browser = hub.browser();
    expectRefused(await hub.signIn(browser), "unknown");
    expect(browser.session).toBeUndefined();
    // Its name, not its message: a message can say anything.
    const refusedUnknown = (why: string) =>
      `signin_refused unknown discord:${ACCOUNT_ID} ` +
      `(Discord did not say whether the account is a member: ${why})`;
    expect(logged()).toBe(refusedUnknown("an unexpected Error"));

    // And with the real client, on every answer of Discord's that isn't a plain yes or no. The
    // log says which step failed and how, never what Discord's body held nor the token.
    const json = (body: unknown, status = 200) => () => Response.json(body, { status });
    const answered = (status: number) => `Discord answered ${status} to read the membership`;
    const noPending = `${answered(200)} without a boolean \`pending\``;
    const unreachable = (name: string) => `could not reach Discord to read the membership (${name})`;
    const answers: [string, () => Response | Error, string, string?][] = [
      [
        "a rejected token",
        json({ message: "401: Unauthorized", code: 0 }, 401),
        "unknown",
        answered(401),
      ],
      ["an outage", () => new Response("", { status: 500 }), "unknown", answered(500)],
      ["a gateway's error", () => new Response("<html>", { status: 502 }), "unknown", answered(502)],
      ["a rate limit", json({ retry_after: 1 }, 429), "unknown", answered(429)],
      [
        "a bare 404",
        () => new Response("<html>Not Found</html>", { status: 404 }),
        "unknown",
        answered(404),
      ],
      ["a 404 with another code", json({ code: 0 }, 404), "unknown", answered(404)],
      ["a 200 that doesn't parse", () => new Response("<html>"), "unknown", noPending],
      ["a member answer without `pending`", json({ roles: [] }), "unknown", noPending],
      ["a `pending` that isn't a boolean", json({ pending: "no" }), "unknown", noPending],
      [
        "a timeout",
        () => new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        "unknown",
        unreachable("TimeoutError"),
      ],
      ["no answer", () => new TypeError("fetch failed"), "unknown", unreachable("TypeError")],
      ["Unknown Member", json({ code: 10007, message: "Unknown Member" }, 404), "not_member"],
      ["Unknown Guild", json({ code: 10004, message: "Unknown Guild" }, 404), "not_member"],
      ["a member still in screening", json({ pending: true, roles: [] }), "pending_rules"],
    ];
    for (const [name, answer, reason, why] of answers) {
      vi.clearAllMocks();
      const { fetch } = discordApi(answer);
      const real = new Browser(
        createHub(SETTINGS, { discord: httpDiscord(SETTINGS, fetch), now: () => NOW }),
      );
      const state = stateOf(await real.request("/api/hub/auth/login"));
      const back = await callback(real, { code: "the-code", state });
      expect(locationOf(back), name).toBe(`/api/login?signin=${reason}`);
      expect(real.session, name).toBeUndefined();
      if (why !== undefined) expect(logged(), name).toBe(refusedUnknown(why));
      for (const held of ["Unauthorized", "<html>", "retry_after", "aborted", "fetch failed"]) {
        expect(logged(), name).not.toContain(held);
      }
      expect(logged(), name).not.toContain("the-access-token");
    }
  });

  it("asks Discord's API with the code, the verifier and that round trip's token", async () => {
    const { fetch, calls } = discordApi(() => Response.json({ pending: false, roles: [] }));
    const browser = new Browser(
      createHub(SETTINGS, { discord: httpDiscord(SETTINGS, fetch), now: () => NOW }),
    );
    const state = stateOf(await browser.request("/api/hub/auth/login"));
    const { verifier } =
      tokens(SETTINGS.sessionSecret, () => NOW).verify<{ verifier: string }>(
        "pending",
        browser.pending,
      ) ?? {};
    const back = await callback(browser, { code: "the-code", state });
    expect(locationOf(back)).toBe("/api/dashboard");

    expect(calls.map((call) => call.url)).toEqual([
      "https://discord.com/api/oauth2/token",
      "https://discord.com/api/users/@me",
      `https://discord.com/api/users/@me/guilds/${GUILD}/member`,
    ]);
    const [exchange, user, member] = calls;
    expect(exchange?.init.method).toBe("POST");
    expect(Object.fromEntries(exchange?.init.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://localhost:5173/api/hub/auth/callback",
      client_id: "1234567890",
      client_secret: "the-client-secret",
      code_verifier: verifier,
    });
    for (const call of [user, member]) {
      expect(call?.init.headers).toEqual({ authorization: "Bearer the-access-token" });
    }
    // Each request gives up on its own.
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(await me(browser)).toEqual({ authenticated: true, id: ACCOUNT_ID, username: "member" });
  });

  it("refuses a callback without its cookie, with another state, or replayed", async () => {
    const hub = startHub();

    // Started in one browser, completed in another.
    const victim = hub.browser();
    const started = await hub.start(victim);
    const stranger = hub.browser();
    expectRefused(await callback(stranger, started), "failed");
    expect(stranger.session).toBeUndefined();

    // Another sign-in's state, genuinely signed, with this browser's cookie.
    const attacker = hub.browser();
    const theirs = await hub.start(attacker);
    expectRefused(await callback(victim, { code: theirs.code, state: theirs.state }), "failed");
    expect(victim.session).toBeUndefined();

    // A state for another action, with this sign-in's own nonce: no sign-in makes one.
    const browser = hub.browser();
    const own = await hub.start(browser);
    const { nonce } = hub.signer.verify<{ nonce: string }>("pending", browser.pending) ?? {};
    const issuing = hub.signer.sign("state", { action: "issue", nonce }, PENDING_TTL_SECONDS);
    expectRefused(await callback(browser, { code: own.code, state: issuing }), "failed");
    expect(browser.session).toBeUndefined();
    expect(hub.discord.exchanges).toEqual([]);

    // Presented a second time: the first went through and took the cookie with it.
    const member = hub.browser();
    const { state, code } = await hub.start(member);
    expect(locationOf(await callback(member, { code, state }))).toBe("/api/dashboard");
    const session = member.session;
    expectRefused(await callback(member, { code, state }), "failed");
    expect(member.session).toBe(session);
    expect(hub.discord.exchanges).toEqual([code]);

    expect(logged()).toContain("signin_refused failed");
    expect(logged()).not.toContain(state);
  });

  it("refuses a state or cookie edited, swapped, missing or out of time", async () => {
    const hub = startHub();
    const browser = hub.browser();
    const { state, code } = await hub.start(browser);
    const pending = browser.pending ?? "";
    const edited = (token: string) => {
      const at = token.indexOf(".") + 1;
      return `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}`;
    };
    for (const [query, cookie] of [
      [{ code, state: edited(state) }, pending],
      [{ code, state }, edited(pending)],
      [{ code, state }, `${pending}x`],
      [{ code, state: pending }, state],
      [{ code }, pending],
      [{ code, state: "" }, pending],
      [{ code, state }, ""],
    ] as const) {
      const fresh = hub.browser();
      expectRefused(await callback(fresh, query, `hub_oauth=${cookie}`), "failed");
      expect(fresh.session).toBeUndefined();
    }
    // The cookie from an earlier sign-in in this browser, with the state of a later one.
    const later = await hub.start(browser);
    expectRefused(await callback(browser, later, `hub_oauth=${pending}`), "failed");

    // Ten minutes after it started.
    const slow = hub.browser();
    const late = await hub.start(slow);
    hub.advance(PENDING_TTL_SECONDS * 1000);
    expectRefused(await callback(slow, late), "failed");
    expect(hub.discord.exchanges).toEqual([]);

    // A callback without a code, or with Discord's own error.
    const discordAnswers: Record<string, string>[] = [
      {},
      { error: "server_error" },
      { error: "invalid_scope" },
    ];
    for (const query of discordAnswers) {
      const other = hub.browser();
      const { state: its } = await hub.start(other);
      expectRefused(await callback(other, { ...query, state: its }), "failed");
    }
  });

  it("refuses a sign-in Discord didn't complete", async () => {
    for (const fail of ["failExchange", "failUser"] as const) {
      const hub = startHub();
      hub.discord[fail] = true;
      const browser = hub.browser();
      expectRefused(await hub.signIn(browser), "failed");
      expect(browser.session).toBeUndefined();
      expect(hub.discord.memberLookups).toEqual([]);
    }
  });

  it("reports a denied consent as cancelled", async () => {
    const hub = startHub();
    const browser = hub.browser();
    const { state } = await hub.start(browser);
    const back = await callback(browser, { error: "access_denied", state });
    expectRefused(back, "cancelled");
    expect(browser.pending).toBeUndefined();
    // Not without a sign-in this browser started.
    const stranger = hub.browser();
    expectRefused(await callback(stranger, { error: "access_denied", state }), "failed");
    expectRefused(await callback(stranger, { error: "access_denied" }), "failed");
    expect(logged()).toContain("signin_refused cancelled");
  });

  it("refuses a token with other scopes", async () => {
    for (const scope of [
      "identify",
      "guilds.members.read",
      "identify guilds.members.read email",
      "identify guilds",
      "identify identify",
      "",
    ]) {
      const hub = startHub();
      hub.discord.scope = scope;
      const browser = hub.browser();
      expectRefused(await hub.signIn(browser), "failed");
      expect(browser.session, scope).toBeUndefined();
      expect(hub.discord.memberLookups, scope).toEqual([]);
    }
    // The two, in either order, are fine.
    for (const scope of [BOTH_SCOPES, "guilds.members.read identify"]) {
      const hub = startHub();
      hub.discord.scope = scope;
      expect(locationOf(await hub.signIn(hub.browser())), scope).toBe("/api/dashboard");
    }
  });
});

describe("the hub's session", () => {
  it("tells /me who is signed in, and nobody for a bad or expired cookie", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const session = browser.session ?? "";

    const answer = await browser.request("/api/hub/me");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      authenticated: true,
      id: ACCOUNT_ID,
      username: "member",
    });
    expect(answer.headers.get("cache-control")).toBe("no-store");

    const edited = `${session.slice(0, -2)}${session.endsWith("AA") ? "BB" : "AA"}`;
    const anonymous = hub.browser();
    const { state } = await hub.start(anonymous);
    const pending = anonymous.pending ?? "";
    const otherSecret = tokens(Buffer.alloc(32, 1), () => NOW).sign(
      "session",
      { id: ACCOUNT_ID, username: "member" },
      SESSION_TTL_SECONDS,
    );
    // A value signed for another purpose, even one holding a session's claims, is not a session.
    const asOther = (["state", "pending"] as const).map((context) =>
      hub.signer.sign(context, { id: ACCOUNT_ID, username: "member" }, SESSION_TTL_SECONDS),
    );
    for (const cookie of [
      edited,
      state,
      pending,
      ...asOther,
      otherSecret,
      "garbage",
      ".",
      "a.b.c",
      "",
    ]) {
      const response = await anonymous.request("/api/hub/me", { cookie: `hub_session=${cookie}` });
      expect(response.status, cookie).toBe(200);
      expect(await response.json(), cookie).toEqual({ authenticated: false });
    }
    expect(await me(hub.browser())).toEqual({ authenticated: false });

    hub.advance(SESSION_TTL_SECONDS * 1000 - 1000);
    expect(await me(browser)).toMatchObject({ authenticated: true });
    hub.advance(2000);
    expect(await me(browser)).toEqual({ authenticated: false });
  });

  it("signs out only with the hub's Origin", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);

    for (const origin of [
      null,
      "null",
      "https://evil.example",
      "http://localhost:5174",
      "https://localhost:5173",
      "http://localhost:5173.evil.example",
      "http://localhost:5173/",
    ]) {
      const response = await browser.request("/api/hub/auth/logout", { method: "POST", origin });
      expect(response.status, String(origin)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_origin" });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await me(browser)).toMatchObject({ authenticated: true });

    const out = await browser.request("/api/hub/auth/logout", { method: "POST" });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()).toEqual([
      "hub_session=; Path=/api/hub; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    expect(browser.session).toBeUndefined();
    expect(await me(browser)).toEqual({ authenticated: false });
  });

  it("answers 503 sign_in_not_configured on every route without settings", async () => {
    const hub = createHub(undefined);
    for (const [path, init] of [
      ["/api/hub/auth/login", {}],
      ["/api/hub/auth/callback?code=c&state=s", {}],
      ["/api/hub/me", {}],
      ["/api/hub/auth/logout", { method: "POST", headers: { origin: PUBLIC_ORIGIN } }],
      ["/api/hub/auth/logout", { method: "POST" }],
    ] as const) {
      const response = await send(hub, path, init);
      expect(response.status, path).toBe(503);
      expect(await response.json()).toEqual({ error: "sign_in_not_configured" });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  // Every test's answers are checked for 403 and 404 after it (`afterEach` above); this one is for
  // what the hub doesn't serve: an unknown path, or a route with another method.
  it("never answers 403 or 404 for what it doesn't serve", async () => {
    const browser = startHub().browser();
    for (const [path, method] of [
      ["/api/hub/nothing", "GET"],
      ["/api/hub/auth", "GET"],
      ["/api/hub/auth/logout", "GET"],
      ["/api/hub/me", "POST"],
      ["/api/hub/auth/login", "POST"],
      // A link can't start an issue: only the form's `POST` does.
      ["/api/hub/auth/issue", "GET"],
      ["/api/hub/auth/issue?product=prices", "GET"],
    ] as const) {
      const response = await browser.request(path, { method });
      // A `POST` here names the page's origin, so it is the route that is refused.
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(await response.json(), `${method} ${path}`).toEqual({ error: "unknown_route" });
    }
  });
});

/** Discord's epoch, 2015-01-01T00:00:00Z: a snowflake's time counts from it. */
const DISCORD_EPOCH = 1_420_070_400_000;
/** The id Discord would give an account made at `ms`. */
const idMadeAt = (ms: number) => (BigInt(ms - DISCORD_EPOCH) << 22n).toString();
/** Another Discord account: the spec's test vector's. */
const OTHER_ID = "80351110224678912";

/** Back on the Prices tab with `outcome` in the address, and no session set by that answer. */
function expectLanded(response: Response, outcome: string) {
  expect(response.status).toBe(303);
  expect(locationOf(response)).toBe(`/api/dashboard/prices?issue=${outcome}`);
  expect(response.headers.getSetCookie().filter((line) => line.startsWith("hub_session="))).toEqual(
    [],
  );
}

describe("a Discord account's age", () => {
  it("is read from its id", () => {
    // Discord's own example: an account made on 2016-04-30.
    expect(createdAt(ACCOUNT_ID)).toBe(Date.parse("2016-04-30T11:18:25.796Z"));
    expect(createdAt(idMadeAt(NOW))).toBe(NOW);
    expect(createdAt("0")).toBe(DISCORD_EPOCH);
    // The largest a snowflake can be: 64 bits, the time in the top 42.
    expect(createdAt("18446744073709551615")).toBe(DISCORD_EPOCH + 2 ** 42 - 1);
  });
});

describe("Get API Key", () => {
  it("starts a silent round trip to Discord, the action and product signed into both halves", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const session = browser.session;

    const started = await hub.getKey(browser);
    expect(started.status).toBe(303);
    expect(started.headers.get("cache-control")).toBe("no-store");
    expect(started.headers.getSetCookie()).toEqual([
      expect.stringMatching(cookieLine("hub_oauth", "/api/hub/auth", PENDING_TTL_SECONDS)),
    ]);
    expect(browser.session).toBe(session);

    // Without a consent screen, to the same callback as a sign-in; a sign-in asks with one.
    const [signin, issue] = hub.discord.authorizations;
    expect(signin?.prompt).toBeUndefined();
    expect(issue).toEqual({
      state: stateOf(started),
      challenge: expect.stringMatching(/^[\w-]{43}$/),
      redirectUri: "http://localhost:5173/api/hub/auth/callback",
      prompt: "none",
    });

    const pending = hub.signer.verify<{ nonce: string; verifier: string; exp: number }>(
      "pending",
      browser.pending,
    );
    expect(pending).toEqual({
      action: "issue",
      product: "prices",
      account: ACCOUNT_ID,
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      verifier: expect.stringMatching(/^[\w-]{43}$/),
      exp: NOW / 1000 + PENDING_TTL_SECONDS,
    });
    // The account stays in the browser's half: what Discord carries names none.
    expect(hub.signer.verify("state", stateOf(started))).toEqual({
      action: "issue",
      product: "prices",
      nonce: pending?.nonce,
      exp: pending?.exp,
    });
    expect(createHash("sha256").update(pending?.verifier ?? "").digest("base64url")).toBe(
      issue?.challenge,
    );

    // Nothing is asked of Discord's API or of Prices until Discord sends the browser back.
    expect(hub.discord.exchanges).toHaveLength(1);
    expect(hub.prices.calls).toEqual([]);
  });

  it("asks the real Discord for prompt=none, and otherwise as a sign-in does", async () => {
    const session = tokens(SETTINGS.sessionSecret, () => NOW).sign(
      "session",
      { id: ACCOUNT_ID, username: "member" },
      SESSION_TTL_SECONDS,
    );
    const browser = new Browser(createHub(SETTINGS, { now: () => NOW }));
    browser.session = session;
    const started = await browser.request("/api/hub/auth/issue", {
      method: "POST",
      form: "product=prices",
    });
    expect(started.status).toBe(303);
    const to = new URL(locationOf(started));
    expect(`${to.origin}${to.pathname}`).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(to.searchParams)).toEqual({
      response_type: "code",
      client_id: "1234567890",
      scope: "identify guilds.members.read",
      redirect_uri: "http://localhost:5173/api/hub/auth/callback",
      state: expect.stringMatching(new RegExp(`^${TOKEN}$`)),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
      prompt: "none",
    });
  });

  it("issues a key once the gates pass on that round trip's answer, and lands on issued", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    // Signing in asks Prices nothing.
    expect(hub.prices.calls).toEqual([]);
    const session = browser.session;

    const { state, code } = await hub.startIssue(browser);
    const back = await callback(browser, { code, state });
    expectLanded(back, "issued");
    // The browser's half is gone; the session is as it was, not made again.
    expect(back.headers.getSetCookie()).toEqual([
      "hub_oauth=; Path=/api/hub/auth; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    expect(browser.pending).toBeUndefined();
    expect(browser.session).toBe(session);

    // The membership was read again, with the issue's own token.
    const [signInCode = ""] = hub.discord.exchanges;
    expect(hub.discord.exchanges).toEqual([signInCode, code]);
    expect(hub.discord.memberLookups).toEqual([
      { token: hub.discord.tokenFor(signInCode), guildId: GUILD },
      { token: hub.discord.tokenFor(code), guildId: GUILD },
    ]);
    // One call to Prices: key/issue, with a token for issue, for the session's account.
    expect(hub.prices.calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", `${PRICES_API}/key/issue`],
    ]);
    const [call] = hub.prices.accepted;
    expect(call?.claims).toMatchObject({
      act: "issue",
      sub: `discord:${ACCOUNT_ID}`,
      name: "member",
    });

    expect(logged().split("\n")).toEqual([
      `signed_in discord:${ACCOUNT_ID}`,
      `prices_key_issue issued discord:${ACCOUNT_ID} jti:${call?.claims.jti}`,
    ]);
    for (const secret of [
      code,
      state,
      hub.discord.tokenFor(code),
      session ?? "",
      call?.token ?? "",
      KEY_VALUE,
    ]) {
      expect(logged()).not.toContain(secret);
    }
  });

  it("passes each of Prices' outcomes on in the address, and nothing else of its answer", async () => {
    for (const body of [
      { outcome: "issued" },
      { outcome: "has_key" },
      { outcome: "capped", next_eligible_at: "2026-12-01T00:00:00Z" },
      { outcome: "too_young" },
      { outcome: "failed" },
    ]) {
      vi.clearAllMocks();
      const hub = startHub();
      hub.prices.answer("/key/issue", () => Response.json(body));
      const browser = hub.browser();
      await hub.signIn(browser);
      expectLanded(await hub.issue(browser), body.outcome);
      expect(hub.prices.accepted).toHaveLength(1);
      expect(logged()).toContain(`prices_key_issue ${body.outcome} discord:${ACCOUNT_ID}`);
    }
  });

  // One line for one failed issue, saying it failed and why, with the token's jti: the client's.
  it("lands on failed when Prices gives no outcome, logging the failure once", async () => {
    const cases: [string, (() => Answer)[], string][] = [
      ["Prices' own error", [envelope(500, "internal_error")], "Prices answered 500 internal_error"],
      ["a refused token", [envelope(401, "invalid_token")], "Prices answered 401 invalid_token"],
      [
        "a gateway's 429",
        [() => new Response("", { status: 429 })],
        "Prices answered 429 without its error envelope",
      ],
      [
        "an HTML 502",
        [() => new Response("<html>", { status: 502 })],
        "Prices answered 502 without its error envelope",
      ],
      [
        "an unknown outcome",
        [() => Response.json({ outcome: "maybe" })],
        "Prices answered 200 without a known outcome",
      ],
      ["no answer", [() => new TypeError("fetch failed")], "could not reach Prices: TypeError"],
    ];
    for (const [what, answers, why] of cases) {
      vi.clearAllMocks();
      const hub = startHub();
      hub.prices.answer("/key/issue", ...answers);
      const browser = hub.browser();
      await hub.signIn(browser);
      const back = await hub.issue(browser);
      expectLanded(back, "failed");
      const [call] = hub.prices.accepted;
      expect(logged().split("\n"), what).toEqual([
        `signed_in discord:${ACCOUNT_ID}`,
        `prices_call_failed issue discord:${ACCOUNT_ID} jti:${call?.claims.jti} (${why})`,
      ]);
    }

    // A 503 twice: the retry is said, then the failure, once.
    vi.clearAllMocks();
    const busy = startHub();
    busy.prices.answer(
      "/key/issue",
      envelope(503, "hub_unconfigured"),
      envelope(503, "hub_unconfigured"),
    );
    const its = busy.browser();
    await busy.signIn(its);
    expectLanded(await busy.issue(its), "failed");
    const [, second] = busy.prices.accepted;
    expect(logged().split("\n").slice(-1)).toEqual([
      `prices_call_failed issue discord:${ACCOUNT_ID} jti:${second?.claims.jti} ` +
        "(Prices answered 503 hub_unconfigured)",
    ]);
    expect(logged()).not.toContain("issue_refused");

    // The secret out of reach: Prices is never asked, and the reader has logged why.
    vi.clearAllMocks();
    const unread = startHub({}, { pricesSecret: () => Promise.reject(new Error("no secret")) });
    const browser = unread.browser();
    await unread.signIn(browser);
    expectLanded(await unread.issue(browser), "failed");
    expect(unread.prices.calls).toEqual([]);
    expect(logged().split("\n")).toEqual([
      `signed_in discord:${ACCOUNT_ID}`,
      `prices_call_failed issue discord:${ACCOUNT_ID} (the secret could not be read)`,
    ]);
  });

  // CloudFront waits 30 s for an origin: Discord's three steps (4 s each at most) and Prices'
  // issue share one deadline, and Prices gets what Discord left of it.
  it("gives Prices what Discord's steps left of the callback's 25 seconds", async () => {
    vi.useFakeTimers();
    expect(ISSUE_CALLBACK_TIMEOUT_MS).toBe(25_000);
    /** Each of Discord's three steps takes `ms` on the hub's clock. */
    const slowDiscord = (hub: ReturnType<typeof startHub>, ms: number) => {
      const { discord } = hub;
      for (const step of ["exchange", "user", "member"] as const) {
        const original = discord[step].bind(discord) as (...args: unknown[]) => unknown;
        (discord as unknown as Record<string, unknown>)[step] = (...args: unknown[]) => {
          hub.advance(ms);
          return original(...args);
        };
      }
    };

    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    slowDiscord(hub, 4_000);
    hub.prices.answer("/key/issue", () => "hang");
    let settled = false;
    const back = hub.issue(browser).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(13_000 - 1);
    expect(settled).toBe(false);
    expect(hub.prices.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expectLanded(await back, "failed");
    const [call] = hub.prices.accepted;
    expect(call?.signal?.aborted).toBe(true);
    expect(logged().split("\n")).toEqual([
      `signed_in discord:${ACCOUNT_ID}`,
      `prices_call_failed issue discord:${ACCOUNT_ID} jti:${call?.claims.jti} ` +
        "(Prices did not answer in 13 s)",
    ]);
    expect(vi.getTimerCount()).toBe(0);

    // Quick steps leave Prices its own 20 s, no more.
    vi.clearAllMocks();
    const quick = startHub();
    const its = quick.browser();
    await quick.signIn(its);
    quick.prices.answer("/key/issue", () => "hang");
    let done = false;
    const landed = quick.issue(its).finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(20_000 - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expectLanded(await landed, "failed");
    expect(logged()).toMatch(/\(Prices did not answer in 20 s\)$/);

    // Discord took it all: Prices isn't asked.
    vi.clearAllMocks();
    const spent = startHub();
    const theirs = spent.browser();
    await spent.signIn(theirs);
    slowDiscord(spent, 9_000);
    expectLanded(await spent.issue(theirs), "failed");
    expect(spent.prices.calls).toEqual([]);
    expect(logged().split("\n")).toEqual([
      `signed_in discord:${ACCOUNT_ID}`,
      `issue_refused failed discord:${ACCOUNT_ID} (Discord took the callback's 25 s, so Prices was not asked)`,
    ]);
  });

  it.each([
    ["not_member", "not_member"],
    ["pending", "pending_rules"],
    ["unknown", "unknown"],
  ] as const)("refuses a %s answer as %s, asking Prices nothing", async (answer, reason) => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    // Since the sign-in, the account left the server or is back in screening.
    hub.discord.memberAnswer = answer;
    expectLanded(await hub.issue(browser), reason);
    expect(hub.prices.calls).toEqual([]);
    expect(hub.discord.memberLookups).toHaveLength(2);
    expect(logged()).toContain(`issue_refused ${reason} discord:${ACCOUNT_ID}`);
    // Still signed in: a refused key is not a sign-out.
    expect(await me(browser)).toMatchObject({ authenticated: true });
  });

  it("treats Discord failing on the member lookup as unknown", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    hub.discord.memberAnswer = new Error("socket hang up");
    expectLanded(await hub.issue(browser), "unknown");
    expect(hub.prices.calls).toEqual([]);
    expect(logged()).toContain(
      `issue_refused unknown discord:${ACCOUNT_ID} ` +
        "(Discord did not say whether the account is a member: an unexpected Error)",
    );
  });

  it("refuses an account younger than the setting as too_young, though it may sign in", async () => {
    const young = idMadeAt(NOW - 5 * 60_000 + 1000);
    const hub = startHub();
    hub.discord.account = { id: young, username: "newcomer" };
    const browser = hub.browser();
    // Age is a gate on keys only.
    expect(locationOf(await hub.signIn(browser))).toBe("/api/dashboard");
    expectLanded(await hub.issue(browser), "too_young");
    expect(hub.prices.calls).toEqual([]);
    expect(logged()).toContain(
      `issue_refused too_young discord:${young} (the account is younger than 5 minutes)`,
    );

    // Five minutes old is old enough.
    hub.advance(1000);
    expectLanded(await hub.issue(browser), "issued");
    expect(hub.prices.accepted.map((call) => call.claims.sub)).toEqual([`discord:${young}`]);

    // The setting decides, and an id from the future is never old enough.
    for (const [minutes, age, outcome] of [
      [0, 0, "issued"],
      [0, -60_000, "too_young"],
      [60, 60 * 60_000 - 1, "too_young"],
      [60, 60 * 60_000, "issued"],
    ] as const) {
      const other = startHub({ minAccountAgeMinutes: minutes });
      other.discord.account = { id: idMadeAt(NOW - age), username: "newcomer" };
      const its = other.browser();
      await other.signIn(its);
      expectLanded(await other.issue(its), outcome);
    }
  });

  // Review focus 1: another site can't make a signed-in visitor's browser ask for a key.
  it("refuses a POST from another site or without an Origin, and a link, starting nothing", async () => {
    let reads = 0;
    const hub = startHub(
      {},
      {
        pricesSecret: () => {
          reads += 1;
          return Promise.resolve(PRICES_SECRET);
        },
      },
    );
    const browser = hub.browser();
    await hub.signIn(browser);
    for (const origin of [
      null,
      "null",
      "https://evil.example",
      "http://localhost:5174",
      "https://localhost:5173",
      "http://localhost:5173.evil.example",
    ]) {
      const response = await browser.request("/api/hub/auth/issue", {
        method: "POST",
        origin,
        form: "product=prices",
      });
      expect(response.status, String(origin)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_origin" });
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    // A link is a GET: it starts nothing, with or without the action named.
    for (const path of [
      "/api/hub/auth/issue?product=prices",
      "/api/hub/auth/login?action=issue&product=prices",
    ]) {
      const response = await browser.request(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.getSetCookie(), path).toEqual([]);
    }
    // Only the sign-in went to Discord.
    expect(hub.discord.authorizations).toHaveLength(1);
    expect(hub.prices.calls).toEqual([]);
    expect(reads).toBe(0);
  });

  it("refuses an issue's callback replayed, or completed in another browser", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const [signInCode] = hub.discord.exchanges;

    const { state, code } = await hub.startIssue(browser);
    expectLanded(await callback(browser, { code, state }), "issued");
    // Presented again: the first took the browser's half with it.
    expectLanded(await callback(browser, { code, state }), "failed");
    expect(hub.discord.exchanges).toEqual([signInCode, code]);
    expect(hub.prices.calls).toHaveLength(1);

    // Another account's issue, completed in this signed-in browser: its half isn't here.
    const attacker = hub.browser();
    attacker.session = hub.signer.sign(
      "session",
      { id: OTHER_ID, username: "other" },
      SESSION_TTL_SECONDS,
    );
    const theirs = await hub.startIssue(attacker);
    expectLanded(await callback(browser, theirs), "failed");
    // Nor with this browser's own issue under way: its nonce is another.
    await hub.startIssue(browser);
    const again = await hub.startIssue(attacker);
    expectLanded(await callback(browser, again), "failed");
    expect(hub.discord.exchanges).toEqual([signInCode, code]);
    expect(hub.prices.calls).toHaveLength(1);
    // In the issue's words, naming the account that asked when this browser's half says it.
    expect(logged()).toContain("issue_refused failed (no issue was started in this browser)");
    expect(logged()).toContain(
      `issue_refused failed discord:${ACCOUNT_ID} (the state belongs to another issue)`,
    );
    expect(logged()).not.toContain("sign-in");
    expect(logged()).not.toContain(OTHER_ID);
  });

  // Review focus 2: a key is only ever issued to the account whose session asked for it.
  it("refuses Discord answering for another account than the session's as account_mismatch", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);

    // The visitor switched Discord accounts after signing in: Discord comes back for the other.
    hub.discord.account = { id: OTHER_ID, username: "other" };
    expectLanded(await hub.issue(browser), "account_mismatch");
    expect(hub.prices.calls).toEqual([]);
    // Nothing more is read of the other account.
    expect(hub.discord.memberLookups).toHaveLength(1);
    expect(logged()).toContain(
      `issue_refused account_mismatch discord:${ACCOUNT_ID} ` +
        "(Discord answered for another account than the session's)",
    );
    expect(await me(browser)).toEqual({ authenticated: true, id: ACCOUNT_ID, username: "member" });

    // Or the session became the other account's between the press and Discord's answer (a sign-in
    // in another tab), and Discord answers for that one: the key was asked for by the first.
    hub.discord.account = { id: ACCOUNT_ID, username: "member" };
    const pressed = await hub.startIssue(browser);
    const firstSession = browser.session ?? "";
    browser.session = hub.signer.sign(
      "session",
      { id: OTHER_ID, username: "other" },
      SESSION_TTL_SECONDS,
    );
    hub.discord.account = { id: OTHER_ID, username: "other" };
    const exchanged = hub.discord.exchanges.length;
    expectLanded(await callback(browser, pressed), "account_mismatch");
    expect(hub.discord.exchanges).toHaveLength(exchanged);
    expect(logged()).toContain(
      `issue_refused account_mismatch discord:${ACCOUNT_ID} ` +
        "(the session is another account's than the one that asked)",
    );
    expect(logged()).not.toContain(OTHER_ID);

    // Or the session ended in between (signed out in another tab): no key, nothing asked.
    browser.session = firstSession;
    hub.discord.account = { id: ACCOUNT_ID, username: "member" };
    const before = await hub.startIssue(browser);
    await browser.request("/api/hub/auth/logout", { method: "POST" });
    expectLanded(await callback(browser, before), "failed");
    expect(hub.discord.exchanges).toHaveLength(exchanged);
    expect(hub.prices.calls).toEqual([]);
  });

  it("can't complete a sign-in's round trip as an issue, nor an issue's as a sign-in", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const session = browser.session ?? "";
    const exchanged = hub.discord.exchanges.length;
    const nonceOf = (b: Browser) =>
      hub.signer.verify<{ nonce: string }>("pending", b.pending)?.nonce;

    // A sign-in started, and a state for an issue with its nonce, which no round trip makes.
    const signin = await hub.start(browser);
    const asIssue = hub.signer.sign(
      "state",
      { action: "issue", product: "prices", nonce: nonceOf(browser) },
      PENDING_TTL_SECONDS,
    );
    expectRefused(await callback(browser, { code: signin.code, state: asIssue }), "failed");

    // An issue started, and a state for a sign-in with its nonce.
    const issue = await hub.startIssue(browser);
    const asSignin = hub.signer.sign(
      "state",
      { action: "signin", nonce: nonceOf(browser) },
      PENDING_TTL_SECONDS,
    );
    expectLanded(await callback(browser, { code: issue.code, state: asSignin }), "failed");

    // Or a state for another product's issue.
    const other = await hub.startIssue(browser);
    const forX402 = hub.signer.sign(
      "state",
      { action: "issue", product: "x402", nonce: nonceOf(browser) },
      PENDING_TTL_SECONDS,
    );
    expectLanded(await callback(browser, { code: other.code, state: forX402 }), "failed");

    // Or both halves for a product this backend doesn't serve, or an action it doesn't know.
    for (const started of [
      { action: "issue", product: "x402" },
      { action: "issue" },
      { action: "revoke", product: "prices" },
    ]) {
      const halves = { ...started, nonce: "n".repeat(43) };
      const pending = hub.signer.sign(
        "pending",
        { ...halves, verifier: "v".repeat(43), account: ACCOUNT_ID },
        PENDING_TTL_SECONDS,
      );
      const state = hub.signer.sign("state", halves, PENDING_TTL_SECONDS);
      const back = await callback(
        hub.browser(),
        { code: "the-code", state },
        `hub_oauth=${pending}; hub_session=${session}`,
      );
      expectRefused(back, "failed");
    }

    expect(hub.discord.exchanges).toHaveLength(exchanged);
    expect(hub.prices.calls).toEqual([]);
    expect(browser.session).toBe(session);
    expect(logged()).toContain("signin_refused failed (the state is for another action)");
    expect(logged()).toContain(
      `issue_refused failed discord:${ACCOUNT_ID} (the state is for another action)`,
    );
    expect(logged()).toContain(
      `issue_refused failed discord:${ACCOUNT_ID} (the state is for another product)`,
    );
  });

  it("reports a denied consent as cancelled, and Discord's other failures as failed", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const { state } = await hub.startIssue(browser);
    expectLanded(await callback(browser, { error: "access_denied", state }), "cancelled");

    const queries: Record<string, string>[] = [
      { error: "server_error" },
      { error: "interaction_required" },
      {},
    ];
    for (const query of queries) {
      const { state: its } = await hub.startIssue(browser);
      expectLanded(await callback(browser, { ...query, state: its }), "failed");
    }
    for (const fail of ["failExchange", "failUser"] as const) {
      hub.discord[fail] = true;
      expectLanded(await hub.issue(browser), "failed");
      hub.discord[fail] = false;
    }
    hub.discord.scope = "identify guilds.members.read email";
    expectLanded(await hub.issue(browser), "failed");
    expect(hub.prices.calls).toEqual([]);
    expect(hub.discord.memberLookups).toHaveLength(1);

    // Each refusal names the account that asked, from the browser's half, in the issue's words.
    const asker = `discord:${ACCOUNT_ID}`;
    expect(logged().split("\n")).toEqual([
      `signed_in ${asker}`,
      `issue_refused cancelled ${asker} (Discord returned an error)`,
      `issue_refused failed ${asker} (Discord returned an error)`,
      `issue_refused failed ${asker} (Discord returned an error)`,
      `issue_refused failed ${asker} (the callback held no code)`,
      `issue_refused failed ${asker} ` +
        "(Discord did not complete the issue: Discord answered 400 to exchange the code)",
      `issue_refused failed ${asker} ` +
        "(Discord did not complete the issue: Discord answered 401 to read the account)",
      `issue_refused failed ${asker} (Discord granted other scopes than the two asked for)`,
    ]);
  });

  // "Get API Key" is a form, so the browser shows its answer as a page: a refusal in JSON would be
  // shown as its text. A visitor whose session ended (its 24 hours, or Sign out in another tab)
  // signs in again, and a product the backend doesn't serve is a failed issue. Only `bad_origin`
  // stays JSON (above): the page never sends it.
  it("sends a visitor without a session to sign in, and another product to a failed issue, starting nothing", async () => {
    let reads = 0;
    const counting = () => {
      reads += 1;
      return Promise.resolve(PRICES_SECRET);
    };
    const hub = startHub({}, { pricesSecret: counting });
    /** Sent on to `location`, with no cookie set. */
    const expectSent = (response: Response, location: string, label: string) => {
      expect(response.status, label).toBe(303);
      expect(locationOf(response), label).toBe(location);
      expect(response.headers.get("cache-control"), label).toBe("no-store");
      expect(response.headers.getSetCookie(), label).toEqual([]);
    };

    const anonymous = hub.browser();
    for (const form of ["product=prices", "product=x402", ""]) {
      expectSent(await hub.getKey(anonymous, form), "/api/login", form);
    }
    const signedOut = hub.browser();
    await hub.signIn(signedOut);
    await signedOut.request("/api/hub/auth/logout", { method: "POST" });
    expect(signedOut.session).toBeUndefined();
    expectSent(await hub.getKey(signedOut), "/api/login", "signed out");
    // Signed in now, and pressed a day later: the session's 24 hours are up.
    const expiring = hub.browser();
    await hub.signIn(expiring);

    const browser = hub.browser();
    await hub.signIn(browser);
    const failed = "/api/dashboard?issue=failed";
    for (const form of [
      "product=x402",
      "product=Prices",
      "product=",
      "",
      "products=prices",
      "product=prices&product=prices",
      "product=prices&product=x402",
      "product=__proto__",
      "product=constructor",
      "product=prices%00",
      "product=%20prices",
    ]) {
      expectSent(await hub.getKey(browser, form), failed, form);
    }
    // Named anywhere but in a form's urlencoded body.
    for (const [path, form, contentType] of [
      ["/api/hub/auth/issue?product=prices", "", undefined],
      ["/api/hub/auth/issue", '{"product":"prices"}', "application/json"],
      ["/api/hub/auth/issue", "product=prices", "text/plain"],
    ] as const) {
      const response = await browser.request(path, { method: "POST", form, contentType });
      expectSent(response, failed, `${path} ${contentType}`);
    }
    // Prices too, when the backend's own list leaves it out.
    const without = startHub({ products: [] }, { pricesSecret: counting });
    const its = without.browser();
    await without.signIn(its);
    expectSent(await without.getKey(its), failed, "products: []");

    hub.advance(SESSION_TTL_SECONDS * 1000);
    expectSent(await hub.getKey(expiring), "/api/login", "expired");

    // Only the sign-ins went to Discord, and nothing was asked of Prices or of its secret.
    expect(hub.discord.authorizations).toHaveLength(3);
    expect(hub.discord.authorizations.map((started) => started.prompt)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(without.discord.authorizations).toHaveLength(1);
    expect([...hub.prices.calls, ...without.prices.calls]).toEqual([]);
    expect(reads).toBe(0);
    // A product the page asked for and the backend doesn't serve is logged, with who asked: the
    // page shows only that the issue failed.
    const refusals = logged()
      .split("\n")
      .filter((line) => line.startsWith("issue_refused"));
    const refusal =
      `issue_refused failed discord:${ACCOUNT_ID} ` +
      "(the form named no product this backend serves)";
    expect(refusals).toEqual(Array.from({ length: 15 }, () => refusal));
  });
});

/** Discord's API for {@link httpDiscord}: a token, an account, and `memberAnswer` for the membership. */
function discordApi(memberAnswer: () => Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/oauth2/token")) {
      return Promise.resolve(
        Response.json({ access_token: "the-access-token", token_type: "Bearer", scope: BOTH_SCOPES }),
      );
    }
    if (url.endsWith("/users/@me")) {
      return Promise.resolve(Response.json({ id: ACCOUNT_ID, username: "member", email: "x" }));
    }
    const answer = memberAnswer();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("x402, by opt-in", () => {
  const ENV = {
    DISCORD_CLIENT_ID: "1234567890",
    DISCORD_CLIENT_SECRET: "the-client-secret",
    HUB_SESSION_SECRET: Buffer.alloc(32, 9).toString("base64"),
    HUB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  };
  const X402_API = "https://x402-portal.test/api/hub/v1";
  const X402_SECRET = Buffer.alloc(32, 0x58);
  const X402_KEY = "x402_the-revealed-key-value-0123456789";

  function x402Usual(route: ProductRoute, discordId: string): Record<string, unknown> {
    switch (route) {
      case "/account":
        return { key: { state: "active", can_issue: false } };
      case "/key/reveal":
        return { name: `discord-${discordId}-key`, value: X402_KEY };
      case "/key/revoke":
        return { revoked: true };
      case "/key/issue":
        return { outcome: "issued" };
    }
  }

  /** A hub with both products' fakes behind one `fetch`, each told apart by its API. */
  function startBoth(settings: Partial<HubSettings> = {}, deps: HubDeps = {}) {
    const clock = { now: NOW };
    const x402 = new FakeProduct(() => clock.now, {
      product: "x402",
      label: "x402",
      api: X402_API,
      secret: X402_SECRET,
      usual: x402Usual,
    });
    // Prices' fake is the one `startHub` makes: its `fetch` is the fallback.
    const base = startHub(
      { products: ["prices", "x402"], x402HubApi: X402_API, ...settings },
      {
        x402Secret: () => Promise.resolve(X402_SECRET),
        fetch: (input, init) =>
          String(input).startsWith(X402_API)
            ? x402.fetch(input, init)
            : base.prices.fetch(input, init),
        ...deps,
      },
    );
    return { ...base, x402 };
  }

  it("has its settings' defaults, and leaves Prices alone when HUB_PRODUCTS is unset", () => {
    const settings = readSettings(ENV, "/api/");
    expect(settings).toMatchObject({
      x402TokenSecretName: "sorobanscan-hub/production/x402-token",
      x402HubApi: "https://x402-portal.sorobanscan.com/api/hub/v1",
      products: ["prices"],
    });
    expect(readSettings({ ...ENV, HUB_PRODUCTS: "prices,x402" }, "/api/")?.products).toEqual([
      "prices",
      "x402",
    ]);
    expect(readSettings({ ...ENV, HUB_PRODUCTS: " x402 " }, "/api/")?.products).toEqual(["x402"]);
    expect(
      readSettings(
        {
          ...ENV,
          HUB_X402_TOKEN_SECRET: "sorobanscan-hub/staging/x402-token",
          X402_HUB_API: "http://localhost:4022/api/hub/v1",
        },
        "/api/",
      ),
    ).toMatchObject({
      x402TokenSecretName: "sorobanscan-hub/staging/x402-token",
      x402HubApi: "http://localhost:4022/api/hub/v1",
    });
    // Empty is unset.
    expect(readSettings({ ...ENV, HUB_X402_TOKEN_SECRET: "", X402_HUB_API: "" }, "/api/")).toEqual(
      SETTINGS,
    );
  });

  it("refuses a malformed secret name or API, naming the setting and not repeating it", () => {
    const pasted = Buffer.alloc(32, 0xa5).toString("base64");
    for (const [setting, values] of [
      ["HUB_X402_TOKEN_SECRET", ["x402 token", "x402/token\n", pasted]],
      [
        "X402_HUB_API",
        [
          "http://example.com",
          "https://x402-portal.sorobanscan.com/api/hub/v1/",
          "https://user:password@x402-portal.sorobanscan.com/api/hub/v1",
          "https://x402-portal.sorobanscan.com/api/hub/v1?key=1",
        ],
      ],
    ] as const) {
      for (const value of values) {
        let message = "";
        try {
          readSettings({ ...ENV, [setting]: value }, "/api/");
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message, `${setting} ${value}`).toMatch(new RegExp(setting));
        expect(message, `${setting} ${value}`).not.toContain(value.trim());
        expect(message).not.toContain("password");
      }
      // Checked with the required settings missing too.
      expect(() => readSettings({ [setting]: values[0] }, "/api/")).toThrow(new RegExp(setting));
    }
  });

  it("answers 400 unknown_product for x402's routes, and a failed issue, while it isn't served", async () => {
    const hub = startHub();
    const browser = hub.browser();
    await hub.signIn(browser);
    const account = await browser.request("/api/hub/x402/account");
    expect(account.status).toBe(400);
    expect(await account.json()).toEqual({ error: "unknown_product" });
    const failed = await hub.getKey(browser, "product=x402");
    expect(failed.status).toBe(303);
    expect(locationOf(failed)).toBe("/api/dashboard?issue=failed");
    expect(hub.prices.calls).toEqual([]);
  });

  it("answers x402's three calls from x402, and Prices' from Prices", async () => {
    const hub = startBoth();
    const browser = hub.browser();
    await hub.signIn(browser);

    const account = await browser.request("/api/hub/x402/account");
    expect(account.status).toBe(200);
    expect(await account.json()).toEqual({ key: { state: "active", can_issue: false } });
    const reveal = await browser.request("/api/hub/x402/key/reveal", { method: "POST" });
    expect(await reveal.json()).toEqual({
      name: `discord-${ACCOUNT_ID}-key`,
      value: X402_KEY,
    });
    const revoke = await browser.request("/api/hub/x402/key/revoke", { method: "POST" });
    expect(await revoke.json()).toEqual({ revoked: true });
    expect(hub.x402.calls.map((call) => call.url.slice(X402_API.length))).toEqual([
      "/account",
      "/key/reveal",
      "/key/revoke",
    ]);
    expect(hub.prices.calls).toEqual([]);

    expect((await browser.request("/api/hub/prices/account")).status).toBe(200);
    expect(hub.prices.calls).toHaveLength(1);
    expect(hub.x402.calls).toHaveLength(3);
    // Each saw only tokens that verify under its own secret and context.
    expect(hub.x402.calls.map((call) => call.refused)).toEqual([undefined, undefined, undefined]);
    expect(hub.x402.accepted.every((call) => call.claims.aud === "x402")).toBe(true);
    expect(hub.prices.calls.map((call) => call.refused)).toEqual([undefined]);
    expect(hub.prices.accepted.every((call) => call.claims.aud === "prices")).toBe(true);
    // The key reaches no log.
    expect(logged()).not.toContain(X402_KEY);
  });

  /** Presses "Get API Key" for x402 and comes back from Discord, with `answers` queued. */
  async function issueX402(hub: ReturnType<typeof startBoth>, browser: Browser) {
    const started = await hub.getKey(browser, "product=x402");
    expect(started.status).toBe(303);
    const state = stateOf(started);
    return callback(browser, { code: hub.discord.codeFor(state), state });
  }

  it("issues x402's key from 'Get API Key' and lands on x402's tab", async () => {
    const hub = startBoth();
    const browser = hub.browser();
    await hub.signIn(browser);
    const back = await issueX402(hub, browser);
    expect(back.status).toBe(303);
    expect(locationOf(back)).toBe("/api/dashboard/x402?issue=issued");
    expect(hub.x402.calls.map((call) => call.url.slice(X402_API.length))).toEqual(["/key/issue"]);
    expect(hub.x402.accepted[0]?.claims).toMatchObject({ aud: "x402", act: "issue" });
    expect(hub.prices.calls).toEqual([]);
    expect(logged()).toContain(`x402_key_issue issued discord:${ACCOUNT_ID}`);
    expect(logged()).not.toMatch(/Prices/);
  });

  it("refuses x402's key at the gates, landing on x402's tab with the reason", async () => {
    const hub = startBoth();
    const browser = hub.browser();
    await hub.signIn(browser);
    hub.discord.memberAnswer = "pending";
    const back = await issueX402(hub, browser);
    expect(locationOf(back)).toBe("/api/dashboard/x402?issue=pending_rules");
    expect(hub.x402.calls).toEqual([]);
    expect(hub.prices.calls).toEqual([]);
  });

  it("lets x402's unread secret fail x402 alone", async () => {
    const hub = startBoth({}, { x402Secret: () => Promise.reject(new Error("no secret")) });
    const browser = hub.browser();
    await hub.signIn(browser);
    const down = await browser.request("/api/hub/x402/account");
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "product_not_configured" });
    expect((await browser.request("/api/hub/prices/account")).status).toBe(200);
    expect(hub.x402.calls).toEqual([]);
  });
});
