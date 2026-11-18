import { createHmac, timingSafeEqual } from "node:crypto";

/** Prices' hub contract as the tests' settings name it. */
export const PRICES_API = "https://prices-api.test/api/hub/v1";
/** The secret the fake checks tokens with, as Prices reads the shared one: the hub's must match. */
export const PRICES_SECRET = Buffer.alloc(32, 0x42);
/** The key the fake reveals: no log or error of the hub's may hold it. */
export const KEY_VALUE = "pk_the-revealed-key-value-0123456789";

/** The four calls of the contract, by the path after the API's base. */
export type PricesRoute = "/account" | "/key/reveal" | "/key/revoke" | "/key/issue";
const ROUTES: Record<PricesRoute, { method: string; act: string }> = {
  "/account": { method: "GET", act: "read" },
  "/key/reveal": { method: "POST", act: "reveal" },
  "/key/revoke": { method: "POST", act: "revoke" },
  "/key/issue": { method: "POST", act: "issue" },
};

const CONTEXT = "sorobanscan-hub/prices-token/v1";
/** Prices' leeway on `iat` and `exp`, in seconds. */
const LEEWAY = 5;

/** A token's claims, as the hub signs them. */
export interface Claims {
  iss: string;
  aud: string;
  sub: string;
  name: string;
  iat: number;
  exp: number;
  jti: string;
  act: string;
}

/** One request the hub made, as Prices received it. */
export interface PricesCall {
  url: string;
  method: string;
  headers: Headers;
  /** The bearer token, whole. */
  token: string;
  /** Its claims when it was accepted; `undefined` when refused. */
  claims?: Claims;
  /** Why it was refused, when it was. */
  refused?: string;
  signal: AbortSignal | null | undefined;
  redirect: RequestInit["redirect"];
  body: RequestInit["body"];
}

/**
 * What the fake answers a call with: a response, an error `fetch` rejects with, or `hang` for no
 * answer at all. An answer can also come later, as a promise. Until it comes, aborting the
 * request makes `fetch` reject with the signal's reason, as Node's does.
 */
export type Answer = Response | Error | "hang";
/** An answer queued for one call: made when the call comes, now or later. */
export type Answering = () => Answer | Promise<Answer>;

/** `answer`, `ms` after the call: on the test's clock, real or fake. */
export const later =
  (ms: number, answer: () => Answer): Answering =>
  () =>
    new Promise((resolve) => setTimeout(() => resolve(answer()), ms));

/** An answer in Prices' error envelope. */
export const envelope =
  (status: number, code: unknown, details?: unknown) => (): Answer =>
    Response.json(
      {
        code,
        message: `Prices' own words, say-nothing-of-this (${String(code)})`,
        ...(details === undefined ? {} : { details }),
      },
      { status },
    );

/**
 * Prices' hub contract in memory. It checks each token as Prices does (the shared sign-in spec's
 * decision 15, and the Prices plan's rules: the MAC in constant time, `iss`, `aud`, `sub` a
 * `discord:` id, `exp - iat` at most 60 s, `exp` and `iat` within 5 s of its clock, the route's
 * `act`), answering 401 `invalid_token` or 403 `action_not_allowed` when it refuses, and records
 * every call. Each route answers as Prices usually would unless the test queues other answers.
 */
export class FakePrices {
  readonly calls: PricesCall[] = [];
  private readonly queued = new Map<PricesRoute, Answering[]>();

  constructor(
    private readonly now: () => number,
    private readonly secret: Buffer = PRICES_SECRET,
  ) {}

  /** Answers the next calls to `route` with `answers`, in order, then as usual again. */
  answer(route: PricesRoute, ...answers: Answering[]): void {
    this.queued.set(route, [...(this.queued.get(route) ?? []), ...answers]);
  }

  /** The calls Prices accepted the token of. */
  get accepted(): (PricesCall & { claims: Claims })[] {
    return this.calls.filter((call): call is PricesCall & { claims: Claims } => !!call.claims);
  }

  /** The usual answer to `route` for `claims`' account. */
  static usual(route: PricesRoute, discordId: string): Record<string, unknown> {
    switch (route) {
      case "/account":
        return {
          key: {
            state: "active",
            key_id: "k-0001",
            created_at: "2026-11-01T10:00:00Z",
            last_updated_at: "2026-11-01T10:00:00Z",
            can_issue: false,
          },
          details: {
            usage: { used: 120, remaining: 880, limit: 1000, period: "month" },
            free_rate_limit_per_second: 5,
          },
        };
      case "/key/reveal":
        return {
          key_id: "k-0001",
          name: `discord-${discordId}-key`,
          value: KEY_VALUE,
          created_at: "2026-11-01T10:00:00Z",
          last_updated_at: "2026-11-01T10:00:00Z",
        };
      case "/key/revoke":
        return {
          revoked: true,
          next_eligible_at: "2026-12-01T00:00:00Z",
          revoked_at: "2026-11-17T12:00:00Z",
        };
      case "/key/issue":
        return { outcome: "issued" };
    }
  }

  readonly fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    const authorization = headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    const call: PricesCall = {
      url,
      method,
      headers,
      token,
      signal: init.signal,
      redirect: init.redirect,
      body: init.body,
    };
    this.calls.push(call);

    const path = url.startsWith(PRICES_API) ? url.slice(PRICES_API.length) : url;
    const route = ROUTES[path as PricesRoute];
    if (!route) return Promise.resolve(envelope(404, "not_found")() as Response);
    if (method !== route.method) return Promise.resolve(new Response(null, { status: 405 }));

    const verdict = this.verify(token);
    if (typeof verdict === "string") {
      call.refused = verdict;
      return Promise.resolve(envelope(401, "invalid_token")() as Response);
    }
    call.claims = verdict;
    if (verdict.act !== route.act) {
      return Promise.resolve(envelope(403, "action_not_allowed")() as Response);
    }

    const answering =
      this.queued.get(path as PricesRoute)?.shift() ??
      (() =>
        Response.json(FakePrices.usual(path as PricesRoute, verdict.sub.slice("discord:".length))));
    const signal = init.signal;
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      void Promise.resolve(answering()).then((answer) => {
        if (answer === "hang") return;
        if (answer instanceof Error) reject(answer);
        else resolve(answer);
      });
    });
  }) as typeof globalThis.fetch;

  /** The token's claims if Prices would accept it, or why it wouldn't. */
  private verify(token: string): Claims | string {
    const parts = token.split(".");
    const [version, payload = "", mac = ""] = parts;
    if (parts.length !== 3 || version !== "v1") return "not a v1 token";
    const expected = createHmac("sha256", this.secret)
      .update(Buffer.concat([Buffer.from(CONTEXT), Buffer.of(0), Buffer.from(payload)]))
      .digest();
    const given = Buffer.from(mac, "base64url");
    if (
      mac !== given.toString("base64url") ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      return "a MAC that doesn't verify";
    }
    if (payload !== Buffer.from(payload, "base64url").toString("base64url")) {
      return "a payload that isn't base64url";
    }
    let claims: Claims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    } catch {
      return "a payload that isn't JSON";
    }
    const seconds = Math.floor(this.now() / 1000);
    if (claims.iss !== "https://sorobanscan.com/api/hub") return "another issuer";
    if (claims.aud !== "prices") return "another audience";
    if (typeof claims.sub !== "string" || !/^discord:[0-9]{1,20}$/.test(claims.sub)) {
      return "a subject that isn't a Discord id";
    }
    if (typeof claims.name !== "string") return "no name";
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return "no times";
    if (claims.exp - claims.iat > 60) return "a token good for more than 60 s";
    if (claims.exp <= seconds - LEEWAY) return "an expired token";
    if (claims.iat > seconds + LEEWAY) return "a token from the future";
    if (typeof claims.jti !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(claims.jti)) return "no jti";
    if (!Object.values(ROUTES).some((r) => r.act === claims.act)) return "an unknown act";
    return claims;
  }
}
