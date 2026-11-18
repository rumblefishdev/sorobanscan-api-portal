/*
 * The hub's backend as Prices' client: the four calls of Prices' hub contract (the shared sign-in
 * spec's "The dashboard contract"; stellar-prices-api's `portal/hub/`), each with a token of its
 * own (`token.ts`), and each answer made into one the page can read. Prices' own error codes are
 * passed on; anything that isn't Prices' answer (a gateway's, a CDN's, none at all) becomes one of
 * the hub's: `prices_busy` or `prices_unavailable`. No token, key or body is logged.
 */
import { randomBytes } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mintToken, type Act } from "../token.ts";

/** How long a call to Prices may take, the secret's read and its one retry included. */
export const PRICES_TIMEOUT_MS = 20_000;

/** Whom a call is for: the signed-in account, as the session names it. */
export interface Caller {
  discordId: string;
  /** The Discord username, for Prices to name the account by. */
  name: string;
}

/** What Prices' `key/issue` can answer. */
const ISSUE_OUTCOMES = ["issued", "has_key", "capped", "too_young", "failed"] as const;
export type IssueOutcome = (typeof ISSUE_OUTCOMES)[number];
export type IssueBody = { outcome: IssueOutcome; next_eligible_at?: string } & Record<
  string,
  unknown
>;

/**
 * A call's outcome. `ok`: Prices' answer, a JSON object, for the page as it is. Otherwise what the
 * page is told instead, as `{"error": error, "details"?: details}` with `status`: Prices' own code
 * and details, or the hub's `product_not_configured` (503), `prices_busy` (503) or
 * `prices_unavailable` (502).
 */
export type PricesAnswer<Body = Record<string, unknown>> =
  | { ok: true; body: Body }
  | {
      ok: false;
      status: ContentfulStatusCode;
      error: string;
      details?: Record<string, unknown>;
    };

export interface PricesClient {
  /** The account's key and its use: `GET account`, `act` read. */
  account(caller: Caller): Promise<PricesAnswer>;
  /** The key itself: `POST key/reveal`. */
  reveal(caller: Caller): Promise<PricesAnswer>;
  /** Revokes the key: `POST key/revoke`. */
  revoke(caller: Caller): Promise<PricesAnswer>;
  /** Asks for a key: `POST key/issue`. Only after the gates, from the issue's callback. */
  issue(caller: Caller): Promise<PricesAnswer<IssueBody>>;
}

export interface PricesClientOptions {
  /** Prices' hub contract, with no trailing slash: a call goes to `${api}/account`. */
  api: string;
  /**
   * The secret the tokens are signed with (`productSecret`). When it rejects, the call answers
   * `product_not_configured` and logs nothing: the reader logged why. When it hasn't resolved by
   * the call's deadline, the same answer, logged here.
   */
  signer: () => Promise<Buffer>;
  fetchImpl?: typeof globalThis.fetch;
  /** The clock tokens are dated by, in milliseconds. */
  now?: () => number;
}

/** One call of the contract. */
interface Call {
  method: "GET" | "POST";
  path: string;
  act: Act;
  /** What a successful answer is logged as, if it is a key event. */
  event?: (body: Record<string, unknown>) => string;
  /** Whether a successful answer says what the call needs it to. */
  holds?: (body: Record<string, unknown>) => boolean;
}

const CALLS = {
  account: { method: "GET", path: "/account", act: "read" },
  reveal: {
    method: "POST",
    path: "/key/reveal",
    act: "reveal",
    event: () => "prices_key_revealed",
  },
  revoke: {
    method: "POST",
    path: "/key/revoke",
    act: "revoke",
    event: () => "prices_key_revoked",
  },
  issue: {
    method: "POST",
    path: "/key/issue",
    act: "issue",
    event: (body) => `prices_key_issue ${String(body.outcome)}`,
    holds: (body) => (ISSUE_OUTCOMES as readonly unknown[]).includes(body.outcome),
  },
} as const satisfies Record<string, Call>;

const NOT_CONFIGURED = { ok: false, status: 503, error: "product_not_configured" } as const;
const BUSY = { ok: false, status: 503, error: "prices_busy" } as const;
const UNAVAILABLE = { ok: false, status: 502, error: "prices_unavailable" } as const;

/** A code as Prices writes its own: snake_case, so it can be passed on and logged as it is. */
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * Prices' 404s that are the account's state, not a failure: passed on as 409, since the CDN in
 * front of the hub turns every 404 into another page. Any other 404 is a route Prices doesn't
 * have, a fault between the two backends.
 */
const KEY_STATES: readonly string[] = ["no_key", "key_revoked"];
/** The one code whose `details` reach the page: when the key was revoked, when a new one can be. */
const WITH_DETAILS = "key_revoked";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Prices' error envelope's code and details, or `undefined` for any other body. */
function envelopeOf(
  body: unknown,
): { code: string; details?: Record<string, unknown> } | undefined {
  if (!isObject(body) || typeof body.code !== "string" || !CODE.test(body.code)) return undefined;
  return isObject(body.details) ? { code: body.code, details: body.details } : { code: body.code };
}

/**
 * The status Prices' error is passed on with: Prices' own, but for two kinds. A 401 or 403 is
 * Prices refusing the hub's token or its act, a fault between the two backends and not the
 * visitor's, which the page would otherwise read as "not signed in": 502. A 404 is one of
 * {@link KEY_STATES} by now: 409.
 */
function passedOn(status: number): ContentfulStatusCode {
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 409;
  return status as ContentfulStatusCode;
}

/**
 * `promise`, or a rejection once `signal` aborts, whichever comes first. Its listener goes with
 * it, and a rejection of `promise` after the abort is taken here, not left unhandled.
 */
function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) aborted();
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

/** A body as JSON, or `undefined` when it isn't. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** {@link PricesClient} over HTTPS, one call at a time. */
export function pricesClient({
  api,
  signer,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}: PricesClientOptions): PricesClient {
  async function call(
    caller: Caller,
    { method, path, act, event, holds }: Call,
  ): Promise<PricesAnswer> {
    // One deadline for the whole call, from here: the secret's read can take seconds of its own.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), PRICES_TIMEOUT_MS);
    try {
      let secret: Buffer;
      try {
        secret = await beforeAbort(signer(), controller.signal);
      } catch {
        // A read that failed was logged by the reader; one still under way has said nothing yet.
        if (controller.signal.aborted) {
          console.warn(
            `prices_call_failed ${act} discord:${caller.discordId} ` +
              `(the secret was not read in ${PRICES_TIMEOUT_MS / 1000} s)`,
          );
        }
        return NOT_CONFIGURED;
      }

      for (let attempt = 1; ; attempt += 1) {
        // A token for each request, a retry's too: one token, one call.
        const jti = randomBytes(16).toString("base64url");
        const token = mintToken(secret, {
          discordId: caller.discordId,
          name: caller.name,
          act,
          now: now(),
          jti,
        });
        const about = `${act} discord:${caller.discordId} jti:${jti}`;
        const failed = (answer: PricesAnswer, why: string) => {
          console.warn(`prices_call_failed ${about} (${why})`);
          return answer;
        };

        let status: number;
        let body: unknown;
        try {
          const response = await fetchImpl(`${api}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            redirect: "manual",
            signal: controller.signal,
          });
          status = response.status;
          body = parsed(await response.text());
        } catch (error) {
          // The error's name tells a refused connection from a reset; its message is not read.
          return failed(
            UNAVAILABLE,
            controller.signal.aborted
              ? `Prices did not answer in ${PRICES_TIMEOUT_MS / 1000} s`
              : `could not reach Prices: ${error instanceof Error ? error.name : "a failure"}`,
          );
        }

        if (status >= 200 && status < 300) {
          if (!isObject(body)) {
            return failed(UNAVAILABLE, `Prices answered ${status} without a JSON object`);
          }
          if (holds && !holds(body)) {
            return failed(UNAVAILABLE, `Prices answered ${status} without a known outcome`);
          }
          if (event) console.info(`${event(body)} discord:${caller.discordId} jti:${jti}`);
          return { ok: true, body };
        }

        const envelope = status >= 400 ? envelopeOf(body) : undefined;
        const said = envelope
          ? `Prices answered ${status} ${envelope.code}`
          : `Prices answered ${status} without its error envelope`;
        if (status === 503 && attempt === 1) {
          console.warn(`prices_call_retried ${about} (${said})`);
          continue;
        }
        if (!envelope) return failed(status === 429 ? BUSY : UNAVAILABLE, said);
        const keyState = status === 404 && KEY_STATES.includes(envelope.code);
        if (status === 404 && !keyState) return failed(UNAVAILABLE, said);
        const answer: PricesAnswer = {
          ok: false,
          status: passedOn(status),
          error: envelope.code,
          ...(envelope.code === WITH_DETAILS && envelope.details
            ? { details: envelope.details }
            : {}),
        };
        if (!keyState) return failed(answer, said);
        // The account has no key to show or revoke: an answer, not a failed call.
        console.info(`prices_call_answered ${about} (${said})`);
        return answer;
      }
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    account: (caller) => call(caller, CALLS.account),
    reveal: (caller) => call(caller, CALLS.reveal),
    revoke: (caller) => call(caller, CALLS.revoke),
    issue: (caller) => call(caller, CALLS.issue) as Promise<PricesAnswer<IssueBody>>,
  };
}
