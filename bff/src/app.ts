/*
 * The sign-in, the session and the sign-out follow stellar-x402's `apps/portal/src/app.ts` at
 * 4157f642 (Apache-2.0, same organisation): its `/api/auth/login` and `/api/auth/callback`
 * (signed `state`, PKCE, the pending cookie deleted first, the member decision) and its
 * `/api/auth/logout`. Changed: Hono instead of Express, a sign-in only (no key is issued here and
 * there is no database: a product's calls go to its own backend, `products/`), the hub's cookies
 * and paths, refusals sent to the sign-in page by reason, and the page on the same origin, so no
 * CORS of its own. (On `pnpm dev` and `pnpm preview` Vite's CORS runs first and lets a page on
 * another localhost origin read an answer, but not one to a request that carried cookies, since it
 * allows no credentials; and a `POST` still needs the hub's `Origin`.)
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import {
  PENDING_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  pendingPath,
  readCookie,
  secureCookies,
  sessionPath,
  setCookie,
} from "./cookies.ts";
import {
  DiscordError,
  SCOPE,
  createdAt,
  httpDiscord,
  isSnowflake,
  type Discord,
  type MemberAnswer,
} from "./discord.ts";
import { productSecret } from "./product-secret.ts";
import {
  productClient,
  type Caller,
  type IssueOutcome as ProductIssueOutcome,
  type ProductAnswer,
  type ProductClient,
} from "./products/client.ts";
import type { HubSettings } from "./settings.ts";
import { tokens, type Tokens } from "./tokens.ts";

/** How long a session lasts. */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
/** How long a started sign-in can be completed: a consent screen and a two-factor prompt, with room. */
export const PENDING_TTL_SECONDS = 600;
/**
 * How long an issue's callback may take, from Discord sending the browser back to the browser's
 * landing: under CloudFront's 30 s wait for an origin. Discord's three steps take what they take
 * (4 s each at most) and Prices' `key/issue` gets the rest, never more than its own 20 s.
 */
export const ISSUE_CALLBACK_TIMEOUT_MS = 25_000;

/**
 * What a round trip to Discord is for: a sign-in (`GET auth/login`), or a key ("Get API Key", the
 * form's `POST auth/issue`). It is in both signed halves, so a callback completes the action that
 * was started and no other: a sign-in's can't issue a key, nor an issue's make a session.
 */
type Action = "signin" | "issue";
const SIGNIN: Action = "signin";
const ISSUE: Action = "issue";
const ACTIONS: readonly unknown[] = [SIGNIN, ISSUE];

interface SessionClaims extends Record<string, unknown> {
  /** The Discord account's id: the identity. */
  id: string;
  /** Its username, to show on the page. Nothing is decided by it. */
  username: string;
}
/** What Discord carries back in `state`. */
interface StateClaims extends Record<string, unknown> {
  action: Action;
  nonce: string;
  /** An issue's product, by the name in its routes; in both halves, as `action` is. */
  product?: string;
}
/** The half that never leaves the browser: the same nonce, and the PKCE verifier. */
interface PendingClaims extends StateClaims {
  verifier: string;
  /** An issue's account: the session's when "Get API Key" was pressed. Never in `state`. */
  account?: string;
}

/**
 * Why a round trip ended without what it was for, as the page is told: `?signin=` on the sign-in
 * page, `?issue=` on an issue's tab.
 */
type Refusal = "cancelled" | "failed" | "not_member" | "pending_rules" | "unknown";
/**
 * How an issue ended, as its tab is told in `?issue=`: the product's own outcome, or why the
 * product wasn't asked.
 */
type IssueOutcome = ProductIssueOutcome | Refusal | "account_mismatch";

const MEMBER_REFUSALS: Record<Exclude<MemberAnswer, "member">, [Refusal, string]> = {
  not_member: ["not_member", "Discord says the account is not a member of the guild"],
  pending: ["pending_rules", "the account has not cleared the guild's Membership Screening"],
  unknown: ["unknown", "Discord did not say whether the account is a member"],
};

export interface HubDeps {
  discord?: Discord;
  now?: () => number;
  /** How the backend reaches the products' backends: the global `fetch` unless given. */
  fetch?: typeof globalThis.fetch;
  /** The secret the tokens to Prices are signed with: read from Secrets Manager unless given. */
  pricesSecret?: () => Promise<Buffer>;
  /** The same for x402. */
  x402Secret?: () => Promise<Buffer>;
}

/** What {@link requireSession} gives the routes after it: the signed-in account. */
export type SessionEnv = { Variables: { caller: Caller } };

/** The claims of a valid session in the request's cookie, or `undefined`. */
function sessionOf(signer: Tokens, c: Context): SessionClaims | undefined {
  const claims = signer.verify<SessionClaims>(
    "session",
    readCookie(c.req.header("cookie"), SESSION_COOKIE),
  );
  if (!claims || !isSnowflake(claims.id) || typeof claims.username !== "string") return undefined;
  return claims;
}

/**
 * Lets a request through only with a valid session, putting its account in `caller`; anything
 * else is 401 `not_signed_in`, before the route does anything.
 */
export const requireSession =
  (signer: Tokens): MiddlewareHandler<SessionEnv> =>
  async (c, next) => {
    const claims = sessionOf(signer, c);
    if (!claims) return c.json({ error: "not_signed_in" }, 401);
    c.set("caller", { discordId: claims.id, name: claims.username });
    return next();
  };

/** A product's answer as the page reads it: Prices' body, or `{error, details?}`. */
const answered = (c: Context, answer: ProductAnswer) =>
  answer.ok
    ? c.json(answer.body, 200)
    : c.json(
        answer.details ? { error: answer.error, details: answer.details } : { error: answer.error },
        answer.status,
      );

const sameString = (a: string, b: string) => {
  const [left, right] = [Buffer.from(a), Buffer.from(b)];
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Exactly the two scopes asked for, in any order: a token that can do more is one not to hold. */
const isOurScope = (granted: string) => {
  const given = granted.split(/\s+/).filter(Boolean);
  const asked = SCOPE.split(" ");
  return given.length === asked.length && asked.every((scope) => given.includes(scope));
};

/** What a failed Discord step is called in a log: its own message, which names no token or body. */
const describeFailure = (error: unknown) =>
  error instanceof DiscordError
    ? error.message
    : `an unexpected ${error instanceof Error ? error.name : "failure"}`;

/** Every answer is about one browser's sign-in, so no cache keeps one. */
const noStore: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  await next();
};

/**
 * The hub's backend (BFF): sign-in with Discord and the session, under `${base}hub/`.
 *
 * - `GET auth/login` sends the browser to Discord. An `action` other than `signin` is refused
 *   with 400 `unknown_action`.
 * - `POST auth/issue`, a form naming `product`, is "Get API Key": with a session, a product the
 *   settings' `products` name, it sends the browser to Discord with `prompt=none`, for an issue
 *   bound to the session's account. Its answer is a page, so without a session it sends the
 *   browser to `${base}login`, and for another product to `${base}dashboard?issue=failed`.
 * - `GET auth/callback` is where Discord sends it back. A sign-in: a member who has cleared
 *   screening gets a session and goes to `${base}dashboard`; anyone else goes to
 *   `${base}login?signin=<reason>`. An issue: Discord's account must be the session's, a member
 *   who has cleared screening, and at least `minAccountAgeMinutes` old; then the product issues,
 *   and the browser goes to `${base}dashboard/<product>?issue=<outcome>`, the product's outcome
 *   or why it wasn't asked. The whole callback is bounded by `ISSUE_CALLBACK_TIMEOUT_MS`.
 * - `GET me` says who is signed in: `{authenticated: false}` for nobody, never an error.
 * - `POST auth/logout` ends the session.
 * - `GET <product>/account`, `POST <product>/key/reveal` and `POST <product>/key/revoke` are the
 *   product's own calls for the signed-in account (`products/client.ts`), answered with the
 *   product's body or `{error, details?}`. Without a session 401 `not_signed_in`; a product not in
 *   the settings' `products` 400 `unknown_product`; its secret out of reach 503
 *   `product_not_configured`.
 *
 * Every `POST` must name the page's origin: 400 `bad_origin` otherwise. Without settings every
 * route answers 503 `sign_in_not_configured`. A failure of its own is 500 `internal`. It never
 * answers 403 or 404: the production CDN turns those into another page.
 */
export function createHub(settings: HubSettings | undefined, deps: HubDeps = {}): Hono {
  if (!settings) {
    const unconfigured = new Hono();
    unconfigured.use(noStore);
    unconfigured.all("*", (c) => c.json({ error: "sign_in_not_configured" }, 503));
    return unconfigured;
  }

  const { base, publicOrigin, guildId } = settings;
  const now = deps.now ?? Date.now;
  const discord = deps.discord ?? httpDiscord(settings);
  const signer = tokens(settings.sessionSecret, now);
  const signedIn = requireSession(signer);
  /** Each product: its words in a log line, its API and the secret its tokens are signed with. */
  const PRODUCTS = {
    prices: {
      label: "Prices",
      api: settings.pricesHubApi,
      signer: deps.pricesSecret ?? productSecret(settings.pricesTokenSecretName),
    },
    x402: {
      label: "x402",
      api: settings.x402HubApi,
      signer: deps.x402Secret ?? productSecret(settings.x402TokenSecretName),
    },
  } as const;
  /**
   * The products whose routes answer, by the name in the path, each a client of its own. A `Map`:
   * no inherited names. A secret is read (from AWS) when a call needs it, and one product's is
   * out of reach for that product only.
   */
  const products = new Map<string, ProductClient>(
    (Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[])
      .filter((name) => settings.products.includes(name))
      .map((name) => [
        name,
        productClient({
          ...PRODUCTS[name],
          product: name,
          fetchImpl: deps.fetch,
          now,
        }),
      ]),
  );
  const secure = secureCookies(publicOrigin);
  const sessionCookiePath = sessionPath(base);
  const pendingCookiePath = pendingPath(base);
  /** The callback, exactly as the Discord application lists it. */
  const redirectUri = `${publicOrigin}${base}hub/auth/callback`;

  const app = new Hono().basePath(`${base}hub`);
  app.use(noStore);
  app.use(async (c, next) => {
    // A `POST` is the page's only if it names the page's origin: the session cookie reaches this
    // backend from any page of the site, so the cookie alone doesn't say the request came from ours.
    const { method } = c.req;
    if (method !== "GET" && method !== "HEAD" && c.req.header("origin") !== publicOrigin) {
      return c.json({ error: "bad_origin" }, 400);
    }
    return next();
  });
  app.notFound((c) => c.json({ error: "unknown_route" }, 400));
  // Hono's own handler writes the whole error to the console, and an error's message, stack or
  // cause can hold what a request carried. Its name and the route say where to look.
  app.onError((error, c) => {
    console.error(`request_failed ${error.name} ${c.req.method} ${routePath(c)}`);
    return c.json({ error: "internal" }, 500);
  });

  /** A product's name in a log line's words. */
  const labelOf = (name: string) =>
    (PRODUCTS as Record<string, { label: string } | undefined>)[name]?.label ?? name;

  /** A product this backend serves, with its client, by the name in its routes. */
  const served = (name: unknown) => {
    const client = typeof name === "string" ? products.get(name) : undefined;
    return client && { name: name as string, client };
  };

  /**
   * Sends the browser to Discord for `started`: `state` for Discord to carry back, and the
   * browser's half, with the PKCE verifier and `browserOnly`, in a cookie; both signed, with one
   * nonce. `prompt: "none"` skips Discord's consent screen for an account that gave it before.
   */
  const toDiscord = (
    c: Context,
    started: { action: Action; product?: string },
    browserOnly: { account?: string } = {},
    prompt?: "none",
  ) => {
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const state = signer.sign("state", { ...started, nonce }, PENDING_TTL_SECONDS);
    const pending = signer.sign(
      "pending",
      { ...started, nonce, verifier, ...browserOnly },
      PENDING_TTL_SECONDS,
    );
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const to = discord.authorizeUrl({
      state,
      challenge,
      redirectUri,
      ...(prompt === undefined ? {} : { prompt }),
    });
    // Set only once there is somewhere to send the browser.
    c.header(
      "Set-Cookie",
      setCookie(PENDING_COOKIE, pending, pendingCookiePath, PENDING_TTL_SECONDS, secure),
      { append: true },
    );
    return c.redirect(to, 303);
  };

  /** The product a form's urlencoded body names, once, if this backend serves it. */
  const productNamed = async (c: Context) => {
    const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") return undefined;
    const named = new URLSearchParams(await c.req.text()).getAll("product");
    return named.length === 1 ? served(named[0]) : undefined;
  };

  app.get("/auth/login", (c) => {
    // Refused, not read as a sign-in: the callback would then complete another action than the
    // one the visitor confirmed. An issue starts only from `auth/issue`'s `POST`, which a link to
    // here can't make. Named once, or not at all.
    const asked = c.req.queries("action");
    if (asked !== undefined && (asked.length !== 1 || asked[0] !== SIGNIN)) {
      return c.json({ error: "unknown_action" }, 400);
    }
    return toDiscord(c, { action: SIGNIN });
  });

  // "Get API Key": a form's `POST`, never a link. A `GET` would let any site walk a signed-in
  // visitor through Discord's silent round trip to a key with one navigation; the `Origin` check
  // above makes this the page's own. The key is for the session's account, which only the
  // browser's half names, and the callback holds Discord's answer and the session to it.
  //
  // The browser shows this route's answer as a page, so its refusals are pages, not the JSON the
  // page's `fetch` routes answer: a session that ended since the dashboard was drawn (its 24
  // hours, or Sign out in another tab) is sent to sign in again, and a product this backend
  // doesn't serve lands on a failed issue. `bad_origin` stays JSON: the page never sends it.
  app.post("/auth/issue", async (c) => {
    const session = sessionOf(signer, c);
    if (!session) return c.redirect(`${base}login`, 303);
    const product = await productNamed(c);
    if (!product) {
      console.info(
        `issue_refused failed discord:${session.id} ` +
          "(the form named no product this backend serves)",
      );
      return c.redirect(`${base}dashboard?issue=failed`, 303);
    }
    return toDiscord(c, { action: ISSUE, product: product.name }, { account: session.id }, "none");
  });

  app.get("/auth/callback", async (c) => {
    // An issue's deadline counts from here: see `ISSUE_CALLBACK_TIMEOUT_MS`.
    const arrived = now();
    const pending = signer.verify<PendingClaims>(
      "pending",
      readCookie(c.req.header("cookie"), PENDING_COOKIE),
    );
    // Gone before anything else is decided, so the same `code` and `state` presented again find
    // no cookie to match.
    c.header("Set-Cookie", clearCookie(PENDING_COOKIE, pendingCookiePath, secure), {
      append: true,
    });
    const state = signer.verify<StateClaims>("state", c.req.query("state"));

    // Where the browser lands: an issue's tab, or the sign-in page. Read from what the hub signed
    // when the round trip started, the browser's half first; nothing else is decided by it.
    const started = pending ?? state;
    const issuing = started?.action === ISSUE ? served(started.product) : undefined;
    /** What the round trip was for, as a refusal's reason names it. */
    const trip = issuing ? "issue" : "sign-in";
    /**
     * The account an issue was asked for, as this browser's half says it: the hub signed it there
     * from the session that pressed "Get API Key", so each of the issue's refusals can name it.
     */
    const asker =
      pending?.action === ISSUE && isSnowflake(pending.account) ? pending.account : undefined;

    const who = (accountId?: string) => (accountId === undefined ? "" : ` discord:${accountId}`);
    /** Back on `product`'s tab with `outcome`, logged when it isn't the product's own answer. */
    const refuseIssue = (
      product: string,
      outcome: IssueOutcome,
      reason: string,
      accountId: string | undefined = asker,
    ) => {
      console.info(`issue_refused ${outcome}${who(accountId)} (${reason})`);
      return c.redirect(`${base}dashboard/${product}?issue=${outcome}`, 303);
    };
    const refuse = (outcome: Refusal, reason: string, accountId?: string) => {
      if (issuing) return refuseIssue(issuing.name, outcome, reason, accountId ?? asker);
      console.info(`signin_refused ${outcome}${who(accountId)} (${reason})`);
      return c.redirect(`${base}login?signin=${outcome}`, 303);
    };

    if (!pending) return refuse("failed", `no ${trip} was started in this browser`);
    if (!state) return refuse("failed", "the state is missing, edited or expired");
    if (
      typeof pending.nonce !== "string" ||
      typeof state.nonce !== "string" ||
      !sameString(pending.nonce, state.nonce)
    ) {
      return refuse("failed", `the state belongs to another ${trip}`);
    }
    if (pending.action !== state.action || !ACTIONS.includes(pending.action)) {
      return refuse("failed", "the state is for another action");
    }
    if (pending.product !== state.product) {
      return refuse("failed", "the state is for another product");
    }
    if (pending.action === ISSUE && !issuing) {
      return refuse("failed", "the issue is for a product this backend doesn't serve");
    }
    // Discord's own refusal, most often the visitor pressing Cancel on its consent screen.
    const denied = c.req.query("error");
    if (denied !== undefined) {
      return refuse(
        denied === "access_denied" ? "cancelled" : "failed",
        "Discord returned an error",
      );
    }
    const code = c.req.query("code");
    if (!code) return refuse("failed", "the callback held no code");
    if (typeof pending.verifier !== "string") return refuse("failed", "the cookie held no verifier");

    // An issue is for the account whose session pressed "Get API Key", while that session lasts:
    // a sign-in in another tab, or a sign-out, between the press and now is not that account's.
    let issue: { name: string; client: ProductClient; caller: Caller } | undefined;
    if (issuing) {
      const asker = isSnowflake(pending.account) ? pending.account : undefined;
      if (!asker) return refuse("failed", "the cookie named no account");
      const session = sessionOf(signer, c);
      if (!session) return refuse("failed", "the session ended before the key was issued", asker);
      if (session.id !== asker) {
        return refuseIssue(
          issuing.name,
          "account_mismatch",
          "the session is another account's than the one that asked",
          asker,
        );
      }
      issue = { ...issuing, caller: { discordId: session.id, name: session.username } };
    }

    let accessToken: string;
    let user: { id: string; username: string };
    try {
      const granted = await discord.exchange(code, pending.verifier, redirectUri);
      if (!isOurScope(granted.scope)) {
        return refuse("failed", "Discord granted other scopes than the two asked for");
      }
      accessToken = granted.accessToken;
      user = await discord.user(accessToken);
    } catch (error) {
      return refuse("failed", `Discord did not complete the ${trip}: ${describeFailure(error)}`);
    }
    if (!isSnowflake(user.id) || typeof user.username !== "string") {
      return refuse("failed", "Discord's account answer held no id or no username");
    }
    // A visitor who switched Discord accounts since signing in: nothing more is read of the other
    // account, and its id is not logged.
    if (issue && user.id !== issue.caller.discordId) {
      return refuseIssue(
        issue.name,
        "account_mismatch",
        "Discord answered for another account than the session's",
        issue.caller.discordId,
      );
    }

    let answer: MemberAnswer;
    try {
      answer = await discord.member(accessToken, guildId);
    } catch (error) {
      // Discord failing to answer is not Discord saying no.
      const [outcome, reason] = MEMBER_REFUSALS.unknown;
      return refuse(outcome, `${reason}: ${describeFailure(error)}`, user.id);
    }
    if (answer !== "member") {
      const [outcome, reason] = MEMBER_REFUSALS[answer] ?? MEMBER_REFUSALS.unknown;
      return refuse(outcome, reason, user.id);
    }

    // The access token ends here: it was read with, and is stored nowhere.
    if (issue) {
      // The account's age is a gate on keys only: a new account may sign in and look around.
      const minutes = settings.minAccountAgeMinutes;
      if (now() - createdAt(user.id) < minutes * 60_000) {
        return refuseIssue(
          issue.name,
          "too_young",
          `the account is younger than ${minutes} minutes`,
          user.id,
        );
      }
      // The product gets what Discord's steps left of the callback's deadline.
      const left = ISSUE_CALLBACK_TIMEOUT_MS - (now() - arrived);
      if (left <= 0) {
        const budget = `${ISSUE_CALLBACK_TIMEOUT_MS / 1000} s`;
        return refuseIssue(
          issue.name,
          "failed",
          `Discord took the callback's ${budget}, so ${labelOf(issue.name)} was not asked`,
        );
      }
      // The product applies its own rules (one key, a cap after a revoke). The client logs its
      // outcome, or why there was none, once: a failure is `failed` on the tab and no more here.
      const issued = await issue.client.issue(issue.caller, left);
      const outcome = issued.ok ? issued.body.outcome : "failed";
      return c.redirect(`${base}dashboard/${issue.name}?issue=${outcome}`, 303);
    }
    const claims: SessionClaims = { id: user.id, username: user.username.slice(0, 64) };
    c.header(
      "Set-Cookie",
      setCookie(
        SESSION_COOKIE,
        signer.sign("session", claims, SESSION_TTL_SECONDS),
        sessionCookiePath,
        SESSION_TTL_SECONDS,
        secure,
      ),
      { append: true },
    );
    console.info(`signed_in discord:${user.id}`);
    return c.redirect(`${base}dashboard`, 303);
  });

  app.get("/me", (c) => {
    const claims = sessionOf(signer, c);
    if (!claims) return c.json({ authenticated: false });
    return c.json({ authenticated: true, id: claims.id, username: claims.username });
  });

  /** A product's call for the signed-in account, once the product is one this backend serves. */
  const proxied =
    (call: (client: ProductClient, caller: Caller) => Promise<ProductAnswer>) =>
    async (c: Context<SessionEnv>) => {
      const client = products.get(c.req.param("product") ?? "");
      if (!client) return c.json({ error: "unknown_product" }, 400);
      return answered(c, await call(client, c.get("caller")));
    };
  app.get("/:product/account", signedIn, proxied((client, caller) => client.account(caller)));
  app.post("/:product/key/reveal", signedIn, proxied((client, caller) => client.reveal(caller)));
  app.post("/:product/key/revoke", signedIn, proxied((client, caller) => client.revoke(caller)));

  app.post("/auth/logout", (c) => {
    c.header("Set-Cookie", clearCookie(SESSION_COOKIE, sessionCookiePath, secure), {
      append: true,
    });
    return c.body(null, 204);
  });

  return app;
}
