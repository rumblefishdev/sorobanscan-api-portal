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
  httpDiscord,
  isSnowflake,
  type Discord,
  type MemberAnswer,
} from "./discord.ts";
import { productSecret } from "./product-secret.ts";
import {
  pricesClient,
  type Caller,
  type PricesAnswer,
  type PricesClient,
} from "./products/prices.ts";
import type { HubSettings } from "./settings.ts";
import { tokens, type Tokens } from "./tokens.ts";

/** How long a session lasts. */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
/** How long a started sign-in can be completed: a consent screen and a two-factor prompt, with room. */
export const PENDING_TTL_SECONDS = 600;

/**
 * What a round trip to Discord is for. Only `signin` here; it is in both signed halves all the
 * same, so a callback completes the action that was started and no other once there are more.
 */
type Action = "signin";
const SIGNIN: Action = "signin";

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
}
/** The half that never leaves the browser: the same nonce, and the PKCE verifier. */
interface PendingClaims extends StateClaims {
  verifier: string;
}

/** Why a sign-in ended without a session, as the sign-in page is told in `?signin=`. */
type Refusal = "cancelled" | "failed" | "not_member" | "pending_rules" | "unknown";

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
const answered = (c: Context, answer: PricesAnswer) =>
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
 * - `GET auth/callback` is where Discord sends it back: a member who has cleared screening gets a
 *   session and goes to `${base}dashboard`; anyone else goes to `${base}login?signin=<reason>`.
 * - `GET me` says who is signed in: `{authenticated: false}` for nobody, never an error.
 * - `POST auth/logout` ends the session.
 * - `GET <product>/account`, `POST <product>/key/reveal` and `POST <product>/key/revoke` are the
 *   product's own calls for the signed-in account (`products/prices.ts`), answered with the
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
  // Asks AWS nothing until a call to Prices needs the secret.
  const prices = pricesClient({
    api: settings.pricesHubApi,
    signer: deps.pricesSecret ?? productSecret(settings.pricesTokenSecretName),
    fetchImpl: deps.fetch,
    now,
  });
  /** The products whose routes answer, by the name in the path. A `Map`: no inherited names. */
  const products = new Map<string, PricesClient>(
    settings.products.includes("prices") ? [["prices", prices]] : [],
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

  app.get("/auth/login", (c) => {
    // Refused, not read as a sign-in: the callback would then complete another action than the
    // one the visitor confirmed, once there are more. Named once, or not at all.
    const asked = c.req.queries("action");
    if (asked !== undefined && (asked.length !== 1 || asked[0] !== SIGNIN)) {
      return c.json({ error: "unknown_action" }, 400);
    }
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const state = signer.sign("state", { action: SIGNIN, nonce }, PENDING_TTL_SECONDS);
    const pending = signer.sign(
      "pending",
      { action: SIGNIN, nonce, verifier },
      PENDING_TTL_SECONDS,
    );
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const to = discord.authorizeUrl({ state, challenge, redirectUri });
    // Set only once there is somewhere to send the browser.
    c.header(
      "Set-Cookie",
      setCookie(PENDING_COOKIE, pending, pendingCookiePath, PENDING_TTL_SECONDS, secure),
      { append: true },
    );
    return c.redirect(to, 303);
  });

  app.get("/auth/callback", async (c) => {
    const pending = signer.verify<PendingClaims>(
      "pending",
      readCookie(c.req.header("cookie"), PENDING_COOKIE),
    );
    // Gone before anything else is decided, so the same `code` and `state` presented again find
    // no cookie to match.
    c.header("Set-Cookie", clearCookie(PENDING_COOKIE, pendingCookiePath, secure), {
      append: true,
    });

    const refuse = (outcome: Refusal, reason: string, accountId?: string) => {
      const who = accountId === undefined ? "" : ` discord:${accountId}`;
      console.info(`signin_refused ${outcome}${who} (${reason})`);
      return c.redirect(`${base}login?signin=${outcome}`, 303);
    };

    const state = signer.verify<StateClaims>("state", c.req.query("state"));
    if (!pending) return refuse("failed", "no sign-in was started in this browser");
    if (!state) return refuse("failed", "the state is missing, edited or expired");
    if (
      typeof pending.nonce !== "string" ||
      typeof state.nonce !== "string" ||
      !sameString(pending.nonce, state.nonce)
    ) {
      return refuse("failed", "the state belongs to another sign-in");
    }
    if (pending.action !== SIGNIN || state.action !== SIGNIN) {
      return refuse("failed", "the state is for another action");
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
      return refuse("failed", `Discord did not complete the sign-in: ${describeFailure(error)}`);
    }
    if (!isSnowflake(user.id) || typeof user.username !== "string") {
      return refuse("failed", "Discord's account answer held no id or no username");
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
    (call: (client: PricesClient, caller: Caller) => Promise<PricesAnswer>) =>
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
